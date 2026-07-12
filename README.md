# Blink

A real-time direct-messaging app. Find people by username, send a follow request, and once you follow **each other** a private chat unlocks. Messages and photos arrive instantly over **Socket.io**, survive a refresh, and carry timestamps, typing indicators, online presence and read receipts.

- **Frontend** — Next.js (React) + Socket.io client
- **Backend** — Node.js + Express + Socket.io + MongoDB (Mongoose)

---

## Contents

- [The flow](#the-flow)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Running the app](#running-the-app)
- [Verifying it works](#verifying-it-works)
- [API reference](#api-reference)
- [Socket events](#socket-events)
- [Design decisions](#design-decisions)
- [Assumptions](#assumptions)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## The flow

Following is a **request**, Instagram-style. It does not take effect until the other person accepts — and that is true in **both** directions, including following back.

```
  ana                                          ben
   │                                            │
   │  People → search "ben" → Follow            │
   ├───────────  follow request  ──────────────▶│  badge appears on People
   │                                            │
   │◀──────────  ana now follows ben  ──────────┤  Accept
   │                                            │
   │      still can't chat — one-way only       │
   │                                            │
   │◀───────────  follow request  ──────────────┤  Ben taps "Follow back"
   │                                            │
   │  Accept                                    │
   ├───────────  ben now follows ana  ─────────▶│
   │                                            │
   │            ✓ mutual — chat unlocks         │
   ▼                                            ▼
              /chat/[chatId] — a private thread
```

Four steps to open a chat: **request → accept → request → accept.** Following back is *not* auto-accepted, even though the other person has already asked to follow you. That costs two extra taps and buys a rule with no exceptions: **nobody ever ends up following someone without having said yes to it.**

A one-way follow is not enough to chat, and a *pending* request is worth less than that. The server re-checks the mutual on every single send, so unfollowing closes the door again even on a thread that already exists.

### The six relationship states

The server collapses these into one word so the UI never has to reason about five booleans at once.

| State | What you see |
|---|---|
| `none` | **Follow** |
| `requestSent` | **Requested** (tap to withdraw) |
| `requestReceived` | **Accept** / **Decline** |
| `following` | **Following** — waiting for them to follow back |
| `followsYou` | **Follow back** — raises a request they must accept |
| `mutual` | **Message** |

---

## Architecture

Two services, one repository. The backend owns **everything** — users, follows, conversations, messages, authentication. The frontend is a pure client: no database, no secrets, no server-side logic.

```
                 ┌──────────────────────────────┐
                 │  Next.js client  (:3000)     │
                 │  inbox · thread · search     │
                 │  holds a JWT, nothing else   │
                 └───────┬──────────────┬───────┘
                         │              │
        Bearer <jwt>     │              │  io(url, { auth: { token } })
        REST             │              │  WebSocket
                         ▼              ▼
                 ┌──────────────────────────────┐
                 │  Express server  (:5000)     │
                 │  ┌────────────┬────────────┐ │
                 │  │  REST API  │ Socket.io  │ │  ← both share ONE http.Server
                 │  └────────────┴────────────┘ │
                 │  auth · users · follows      │
                 │  conversations · messages    │
                 └──────────────┬───────────────┘
                                ▼
                            MongoDB
```

**Why is the backend a separate Express service rather than Next.js API routes?**

Socket.io needs the raw Node `http.Server` so it can answer the `Upgrade: websocket` handshake. Next.js App Router route handlers receive a Web `Request` and return a `Response` — they never expose the underlying server, so Socket.io cannot be attached from inside one. A standalone Express process creates the `http.Server` itself and shares it between Express (HTTP) and Socket.io (WebSocket).

It also means the backend is a plain HTTP + WebSocket API that **any** client can consume — a React Native app could be pointed at it without touching a line of server code.

---

## Project structure

```
viboz/
├── client/                          Next.js frontend — no DB, no secrets
│   └── src/
│       ├── app/
│       │   ├── (auth)/              sign-in · sign-up
│       │   ├── chat/
│       │   │   ├── layout.tsx       two-pane shell (sidebar + right pane)
│       │   │   ├── page.tsx         empty state / inbox on mobile
│       │   │   ├── people/          search · requests · following · followers
│       │   │   └── [chatId]/        one conversation
│       │   └── page.tsx             landing
│       ├── components/
│       │   ├── chat/
│       │   │   ├── Sidebar.tsx          inbox + request badge
│       │   │   ├── ConversationItem.tsx unread badge, last message, typing
│       │   │   ├── ChatThread.tsx       header · list · typing · composer
│       │   │   ├── MessageBubble.tsx    ticks: sent / delivered / read
│       │   │   └── Avatar.tsx
│       │   ├── people/UserRow.tsx       one row per relationship state
│       │   └── ui/icon.tsx              the ONLY place HugeIcons is imported
│       ├── context/
│       │   ├── AuthContext.tsx      holds the JWT + current user
│       │   └── ChatContext.tsx      ONE socket, the inbox, presence, typing
│       ├── hooks/useThread.ts       one open conversation
│       └── lib/chat-api.ts          typed REST client
│
└── server/                          Express + Socket.io backend
    ├── scripts/verify-e2e.ts        132-check end-to-end harness
    └── src/
        ├── models/                  User · FollowRequest · Conversation
        │                            Message · Upload
        ├── routes/                  auth · users · conversations · uploads
        ├── services/                auth · user · conversation · upload
        ├── sockets/                 per-user rooms · presence
        ├── middleware/              auth guard · error funnel
        └── index.ts                 http.createServer(app) + io.attach
```

---

## Setup

Requires **Node.js 18+** and **MongoDB** (local or Atlas). Only the server touches the database.

```bash
git clone <repository-url>
cd viboz

# Backend
cd server
npm install
cp .env.example .env      # fill in MONGODB_URI and JWT_SECRET

# Frontend
cd ../client
npm install
cp .env.example .env      # defaults are fine locally
```

Generate the JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Environment variables

### `server/.env`

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `PORT` | no (default `5000`) | `5000` | Port Express + Socket.io listen on |
| `MONGODB_URI` | **yes** | `mongodb://127.0.0.1:27017/viboz-chat` | Database connection string |
| `JWT_SECRET` | **yes** (min 16 chars) | `k3f9…` | Signs and verifies auth tokens |
| `CLIENT_ORIGIN` | no (default `http://localhost:3000`) | `http://localhost:3000` | Allowed CORS / socket origin. Comma-separate for several |

### `client/.env`

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_CHAT_SERVER_URL` | **yes** | `http://localhost:5000` | Where the browser calls the API and opens the socket |

That is the client's *entire* configuration. It holds no secret and no database credential, because it needs neither.

The server validates its environment on boot and **refuses to start** if something is missing, rather than starting and then failing every request with a `401`.

---

## Running the app

Two terminals.

```bash
cd server && npm run dev     # http://localhost:5000
cd client && npm run dev     # http://localhost:3000
```

To see it work end to end, you need **two accounts**:

1. Sign up as `ana` in one browser, and `ben` in an incognito window.
2. As **ana**: People → search `ben` → **Follow**. It becomes a pending request.
3. As **ben**: a badge appears on People. Open it → **Requests** → **Accept**.
   Ana now follows Ben. Still no chat — it is one-way.
4. As **ben**: **Followers** tab → find ana → **Follow back**. This raises a request too.
5. As **ana**: **Requests** → **Accept**. The chat now appears for *both* of you.
6. Send a message, or attach a photo with the image button.

Also worth trying: start typing, and watch `typing…` appear on the other side and in their inbox row.

---

## Verifying it works

```bash
cd server
npm run test:e2e     # 132 checks
```

The harness boots an **ephemeral MongoDB** (no database of your own needed), starts the real server as a child process, and drives it with three live users. Ana and Ben become mutuals and chat. **Cara is the outsider** — she exists to prove a third party can neither read the thread nor receive its messages on her socket.

Among the things it asserts:

- A message POSTed by Ana arrives on Ben's socket **without a refresh**
- **Cara's socket never receives it** — delivery is scoped, not broadcast
- Following someone new creates a **pending request**, not a follow
- Asking twice does not create a second request; cancelling removes it
- A pending request does **not** unlock chat
- Accepting makes them a follower but does **not** auto-follow them back
- A one-way follow is still **not** enough (403)
- Following back **is** auto-accepted, and that is what unlocks the chat
- Declining leaves no follow behind
- Unfollowing blocks sending again, even though the thread still exists
- Cara gets a `404` (not `403`) on someone else's thread — no existence leak
- A regex typed into the user search is escaped, not executed
- An unknown user and a wrong password return an identical error (no account enumeration)
- A message to an offline user is saved but **not** marked delivered
- A disallowed CORS origin gets no `Access-Control-Allow-Origin` header

---

## API reference

Every response uses the envelope `{ success, data?, message? }`. Everything except `register` / `login` requires `Authorization: Bearer <jwt>`.

### Auth

| Route | Body | Returns |
|---|---|---|
| `POST /api/auth/register` | `{ username, email, password }` | `201` `{ token, user }` — signs you in immediately |
| `POST /api/auth/login` | `{ identifier, password }` | `200` `{ token, user }` — `identifier` is a username *or* an email |
| `GET /api/auth/me` | — | `{ user }` — validates a stored token |
| `GET /api/auth/check-username?username=` | — | `{ available }` |

### People

| Route | Notes |
|---|---|
| `GET /api/users/search?q=` | Users whose username starts with `q`. Never you. |
| `GET /api/users/requests` | Everyone waiting on your decision |
| `GET /api/users/following` | Accepted follows, outgoing |
| `GET /api/users/followers` | Accepted follows, incoming |
| `GET /api/users/mutuals` | Everyone you can actually chat with |
| `POST /api/users/:id/follow` | Ask to follow. `201` + `{ accepted: false }` for a pending request, `200` + `{ accepted: true }` if they already follow you |
| `DELETE /api/users/:id/follow` | Unfollow someone you already follow |
| `DELETE /api/users/:id/request` | Withdraw a request you sent |
| `POST /api/users/:id/accept` | Let them follow you |
| `POST /api/users/:id/decline` | Reject the request |
| `GET /api/users/:id` | One profile |

A user is returned as `{ id, username, isFollowing, followsYou, isMutual, requestSent, requestReceived }`. `isMutual` is the whole authorisation model — the pending flags never grant anything.

### Conversations

| Route | Notes |
|---|---|
| `GET /api/conversations` | The inbox: other user, last message, unread count |
| `POST /api/conversations` | `{ userId }` → find-or-create. **403 unless mutual** |
| `GET /api/conversations/:id` | Thread metadata |
| `GET /api/conversations/:id/messages` | **Chat history** — `?limit` (1–100), `?before` (ISO cursor) |
| `POST /api/conversations/:id/messages` | **Send** — `{ text?, imageKey? }`. `403` if no longer mutual |
| `POST /api/conversations/forward` | `{ messageId, conversationIds[] }` — pass a message on to up to 20 chats |
| `DELETE /api/conversations/:id/messages/:messageId?scope=me\|everyone` | Delete a message. `everyone` is **sender-only** (`403` otherwise) |
| `DELETE /api/conversations/:id?scope=me\|everyone` | Delete a chat. `me` clears your copy; `everyone` destroys it for both |

### Images

| Route | Notes |
|---|---|
| `POST /api/uploads` | Multipart, field `files` — **one or many**, up to 10, 8 MB each. Any type. Always returns an array |
| `GET /api/uploads/:key` | The file. **Unauthenticated** — see the design note below |
| `GET /api/uploads/:key?download=1` | The same file, forced to save rather than open |
| `PATCH /api/users/me/avatar` | `{ avatarKey }` to set your photo, `null` to clear. Must be a real image |

A message body is `{ text?, attachmentKeys? }` — **at least one** is required. Attachments with no caption are a valid message.

### `GET /health`

Unauthenticated liveness probe.

---

## Socket events

Authenticated during the handshake via `auth: { token }` — the same JWT the REST API uses. Every socket joins a room named after its user, so a message reaches exactly the two people in the conversation, across all their open tabs, and nobody else.

**Server → client**

| Event | Payload |
|---|---|
| `message:new` | the saved message |
| `message:status` | `{ conversationId, ids, read }` |
| `message:deleted` | `{ conversationId, id }` — a retraction. Never sent for a delete-for-me |
| `conversation:deleted` | `{ conversationId }` — the thread was destroyed for both |
| `conversation:update` | an inbox row, recomputed for *you* |
| `typing:update` | `{ conversationId, username, isTyping }` |
| `presence:update` | `{ online }` |
| `follow:request` | someone asked to follow you — bumps the badge live |
| `follow:update` | a relationship changed (accepted, declined, unfollowed) |
| `chat:error` | `{ message }` |

**Client → server**

| Event | Payload |
|---|---|
| `typing:start` / `typing:stop` | `{ conversationId }` |
| `message:read` | `{ conversationId }` |

There is deliberately **no** `message:send` — sending is a REST call.

---

## Design decisions

### REST is the write path; Socket.io is the delivery path

The brief asks for both a REST "send message" endpoint *and* Socket.io real-time messaging. These overlap, so they need a clear division of labour:

- `POST /api/conversations/:id/messages` **persists** the message, then the server broadcasts the **saved record** to both participants.
- The socket only ever **delivers**. It never accepts a message.

Nothing is delivered that is not already in the database, so a live client and a refreshing client can never disagree.

### Delivery is scoped, not broadcast

There is no room the whole app shares. Every socket joins `user:<id>`, and a message is emitted to exactly the two rooms belonging to the two participants. The `verify-e2e` harness has a third user, Cara, whose entire job is to sit on a socket and prove she never receives someone else's message.

### The client renders only from the socket, never from the POST response

`send()` throws the response body away. A message enters the UI only when it arrives back over `message:new`.

That gives one render path for your messages and theirs — no optimistic copy to reconcile, no duplicate, and no way to display a message that failed to save. It also makes the socket self-verifying: if your own message appears, delivery is provably working. The cost is one round trip of latency on your own message, which is worth it for the correctness.

### Every follow is a request — including following back

Accepting a request makes the requester follow you. It deliberately does **not** auto-follow them back: accepting is "yes, you may follow me", not "and I will follow you too". Those are different statements, and conflating them would take a decision out of the user's hands.

Following back then raises a request of its own, which *they* must accept. So opening a chat is a four-step handshake: request → accept → request → accept.

An earlier version auto-accepted the follow-back, on the reasoning that someone who has already asked to follow you has made their wishes obvious. That saved two taps but created an exception, and an exception in an authorisation rule is exactly the kind of thing that turns into a hole later. The rule is now absolute: **nobody ever ends up following someone without having said yes to it.**

### The mutual check runs on every send, not just at creation

It would be easy to check "are these two mutuals?" when the conversation is created and then trust the thread forever. That would be a back door: unfollow someone and you could still message them through the existing conversation. So `sendMessage` re-checks, every time. Unfollowing genuinely closes the door — the composer is replaced with an explanation rather than a button that 403s when pressed.

### Forwarding re-uses attachments rather than re-uploading them

When you forward a message, the copy points at the **same upload keys**. The bytes are already in the database; duplicating an 8 MB file per forward would grow storage without adding a pixel.

This required a deliberate exception. `resolveAttachments` refuses any key you do not own — that check exists to stop you attaching an upload key you guessed at. But a forwarded file belongs to whoever originally sent it, so running that check would reject a *legitimate* forward. The exception is safe because authorisation is established a different way: the metadata is copied from a message you have already proven you are allowed to read. Every target chat is still authorised independently, so forwarding is not a way around the mutual-follow rule.

A forward is marked as such, and labelled in the UI. It is a quotation, not something you wrote.

### Downloading media needs the server, not the `download` attribute

The HTML `download` attribute is **ignored for cross-origin URLs**, and the API is a different origin from the app. A `<a download>` on a photo would therefore just open it in a tab — the attribute would silently do nothing.

So the Save button points at `?download=1`, and the *server* switches the `Content-Disposition` to `attachment`. That is the only thing that actually forces a save. Both URLs cache hard and independently, since the query is part of the cache key, so the inline copy can never be served in place of the download.

### Deletion is asymmetric, so it cannot be a boolean

Four different things are all called "delete", and conflating any two of them is a data-loss bug:

| Action | What happens |
|---|---|
| **Message → delete for me** | Your id is added to the message's `deletedFor`. It is hidden from you and **untouched for them**. |
| **Message → delete for everyone** | The content is destroyed and the row survives as a tombstone. **Sender only.** |
| **Chat → delete for me** | A `clearedAt` timestamp is written for you. History before it is hidden, the chat leaves your inbox — and **comes back if they message you again**. |
| **Chat → delete for everyone** | The conversation and every message in it are destroyed, permanently, for both. |

Three decisions worth spelling out:

**Only the sender may retract a message.** If a recipient could delete-for-everyone, anyone could erase what you said to them. That is not a delete button, it is a censorship button.

**A retracted message leaves a tombstone**, not a hole. A message silently vanishing from a conversation reads as a bug, and leaves the other person wondering whether they imagined it. The content really is destroyed in the database, though — a tombstone that still holds the text is a rename, not a deletion.

**"Delete chat for me" is a timestamp, not a flag.** Clearing a chat is not the same as leaving it: you want the history gone, but you have not blocked them. A boolean would force a choice between losing the chat forever and resurrecting the old history along with it. A timestamp gives you both — everything before it stays hidden, and the thread returns clean when they next write.

The `verify-e2e` harness asserts the asymmetry directly: after Ana deletes a message for herself, it checks that **it is still there for Ben**.

### Typing is relayed, never stored

The server holds no typing state at all: it forwards the event to the other participant and forgets. The client expires the indicator on a four-second timer.

This is deliberate. If the server held the state, a browser that died mid-keystroke would leave the other person stuck reading "typing…" forever, because the `typing:stop` that would have cleared it is never sent. Expiring on the client means the worst case is a stale indicator for four seconds.

### The inbox row is computed per viewer

`unreadCount` means "unread **by you**", so the two participants cannot be sent the same `conversation:update` payload. The server builds it separately for each and emits to each user's room.

### A conversation has a unique key on the sorted participant pair

Two people tapping "message" on each other at the same moment would otherwise race and create two conversations for the same pair. The unique key makes that impossible at the database level, and a duplicate-key error is treated as "someone beat me to it" rather than a failure.

### 404, not 403, for a thread you are not in

Returning `403 Forbidden` on someone else's conversation confirms that it exists. `404` tells you nothing you did not already know.

### Authentication lives on the server

The backend is the sole issuer *and* verifier of tokens. It owns the `users` collection, hashes with bcrypt, signs a JWT, and checks that same JWT on both the REST API and the socket handshake. One secret, in one place, and any client — browser, mobile, `curl` — authenticates identically.

Login returns an identical `401` for a wrong password and an unknown user, and still runs bcrypt against a dummy hash when the user is missing, so the response time does not leak which accounts exist either.

### The token lives in `localStorage`, and that is a real trade-off

`localStorage` is readable by any script on the page, so the token is exposed to XSS. The usual mitigation is an httpOnly cookie — but a cookie set by the API's origin (`:5000`) is not sent to the app's origin (`:3000`) in production, so the frontend could never read it to drive the UI. For an app of this size `localStorage` is the honest choice, and it is what a mobile client would need anyway. A production system would want short-lived access tokens plus a refresh token in an httpOnly cookie.

### Attachments: anything, but only images render inline

You can attach up to ten files to a message — photos, PDFs, zips, whatever. Accepting arbitrary file types is only safe because of one rule:

> **Only JPEG, PNG, WebP and GIF are ever served inline. Everything else is forced to download.**

An SVG or an HTML file can carry script. If we served one inline it would execute in *our* origin, with access to whatever the page can see. So they are not rejected — they are served with `Content-Disposition: attachment` and a neutralised `application/octet-stream` content type, which makes them inert. The harness asserts this directly: it uploads an `<svg onload="alert(1)"/>` and checks the response forces a download.

Ownership is checked on **every** key in the list, not just the first — otherwise you could smuggle someone else's upload in among your own.

An avatar has a stricter rule still: it must actually be an image, because it *is* rendered inline. A PDF renamed `.png` gets a `415`.

### Files live in MongoDB, behind a capability URL

Not on disk: Render's free tier has an ephemeral filesystem, so every deploy would wipe every avatar. Not on S3 or Cloudinary: that is another account to create and another credential to leak. Images live with the data they belong to and survive a redeploy for free. The honest limit is that MongoDB is not a CDN — at real scale you would move the bytes to object storage and keep only the key here.

`GET /api/uploads/:key` is **unauthenticated**, and it has to be: an `<img src>` cannot send an `Authorization` header. So the URL itself is the credential. The key is 128 random bits, *not* the ObjectId — ObjectIds are partly a timestamp and a counter, so knowing one lets you guess its neighbours.

Two things this does not give you: anyone who obtains a URL can view that image forever, even after being unfollowed; and the images are not access-controlled per viewer. It is a capability, not an ACL. For genuinely private photos you would want short-lived signed URLs.

What *is* enforced: you can only attach an upload **you** own. Otherwise you could paste someone else's image key onto your own message, or set their photo as your avatar.

### Images are compressed in the browser, not on the server

A photo off a phone is routinely 4–8 MB and 4000px wide, to be displayed in a 300px bubble. Downscaling in the browser (canvas → WebP, falling back to JPEG) means uploads land at 100–400 KB, and the server needs no image library at all — no `sharp`, no native build step on Render. GIFs and SVGs pass through untouched: drawing a GIF to a canvas would silently discard every frame but the first, and an SVG is a document, not a bitmap.

Non-images are never touched. There is nothing useful a browser can do to a PDF, and mangling it would be worse than sending it as-is.

The upload fires the moment files are picked, not when Send is pressed — so by the time a caption is typed they are already on the server and sending feels instant.

### The shell: rail, list, and an inset panel

Three columns on desktop. A narrow icon rail (Chats, Community, and Sign out pinned to the bottom, away from everything else so it is never the thing you hit by accident), the chat list, and the conversation as a panel **inset from the canvas**. The gap around that panel is what makes the chat feel like a surface you are working *on* rather than a region of the page.

**Escape closes the conversation.** It is only ever a navigation — it never deletes or discards anything, so there is nothing to confirm. Two things it deliberately does not do: it does not fire while a dialog or the lightbox is open (those bind Escape themselves and stop the event first — closing the photo *and* the chat with one keypress would be maddening), and it blurs the composer instead of navigating if you are mid-sentence.

**Search in the chat list filters chats you already have**, by name and by what was last said. Finding *new* people is a different job and lives in Community. Conflating the two is how you end up searching for a friend and getting a stranger.

**Mobile is WhatsApp.** One screen at a time: the list fills the display with a bottom nav; opening a chat replaces it entirely and hides the nav, so the conversation gets every pixel. Same routes on both, so a link to a conversation works identically on either.

### Typography: Inter, not a display face

The app was on Space Grotesk, which is drawn to be *looked at*, at size. A chat app is the opposite job: thousands of words at 13–14px that must be read without being noticed. Inter is designed for exactly that — tall x-height, open apertures, unambiguous `1`/`l`/`I` — which is why it sits under most modern product UI.

### Colour: black everywhere, except two places worth spending it on

The logo is black, so black carries every accent — buttons, the unread badge, your own message bubbles.

Two exceptions earn their colour:

**Avatars** get one of fourteen deterministic colours, hashed from the username, so a person is the same colour in the inbox, the thread header and search. Picking those colours took care: the obvious mid-tone greens and oranges (`#16A34A`, `#EA580C`) only manage 3.3–3.6:1 against white text — fine in a mock-up, unreadable in practice. Every colour in the final palette clears 4.5:1, worst case 5.02:1, and the full hue range is preserved so two strangers never look related.

**The online dot is green.** Presence is the one thing in this app that must be glanceable, and a black or grey dot never is.

### Icons go through one module

Every icon in the app is `<Icon name="send" />`, resolved through a single named map in `components/ui/icon.tsx`. [HugeIcons](https://hugeicons.com/icons) ships ~5,500 icons as *data*, rendered through one `<HugeiconsIcon>` component rather than one component per icon, so nothing stops you importing `Sent02Icon` directly in thirty files. Funnelling them through one map means no component ever touches the library — changing the icon set, or the default stroke weight, is a one-file change.

### Design: off-white canvas, white surfaces, black ink

The logo is black, so black carries every accent — buttons, the unread badge, your own message bubbles, the online dot.

The canvas is `#FAFAF9`, deliberately **not** pure white. If the page were `#FFFFFF` there would be nowhere to go for a raised surface — you cannot make a card lighter than white — so cards would have to be grey and would read as recessed rather than elevated. Starting a hair off-white means plain white *is* the elevation.

All text clears WCAG AA (ink on canvas 19:1, muted text 4.5:1). One thing needed care: an input's fill is white on a white card, so its **border** is the only thing marking it as a field. A soft `#E7E5E4` divider would have been invisible there, so `--input` is a darker `#928B87` that clears the 3:1 WCAG requires of a UI component boundary — on both the card and the canvas, since inputs appear on both.

---

## Assumptions

- **Mutual follow is required to chat.** A one-way follow gets you nothing, and a *pending* request gets you less than that.
- **Every follow needs approval, in both directions** — including following back. Four steps to open a chat, by design.
- **A declined request leaves no trace.** They can ask again.
- **Unfollowing hides the door, not the history.** The existing thread stays readable to both, but neither can send until the mutual is restored.
- **Delivered means "they had a live socket when it was sent."** It is not retroactively upgraded when they come online — they will see the message in history, but the sender's tick stays single.
- **Read is acknowledged when the thread is open and scrolled near the bottom**, not merely when it is fetched.
- **Search is a case-insensitive prefix match** on username, capped at 20 results. No fuzzy matching.
- **History loads the latest 50 messages** per thread. The API supports cursor pagination via `before`, but the UI does not yet wire up infinite scroll.
- **Up to 10 attachments per message, 8 MB each**, any file type. Only JPEG/PNG/WebP/GIF ever render inline; everything else downloads. Uploads are never garbage-collected, even when the message referencing them is deleted.
- **File URLs are capabilities, not ACLs.** Anyone holding the URL can fetch it, forever, even after being unfollowed. See the design note.
- **Escape closes an open chat.** It is a navigation, never a deletion.
- **Text messages are capped at 2000 characters.** No editing, no deleting, no attachments other than images.
- **Tokens last 7 days** with no refresh endpoint. An expired token signs you out rather than silently retrying.
- **Forwarding copies, it does not move.** The original stays where it is, and the copy re-uses the same stored file.
- **A forward is labelled.** You cannot pass something on and have it look like your own words.
- **Copying text needs a secure context** (https or localhost) and a focused document — the browser can refuse, and the UI says so rather than failing silently.
- **Deleting a message for yourself is not undoable**, and it does not remove it from their screen.
- **A retracted message leaves a visible tombstone.** You cannot delete a message *silently*.
- **"Delete chat for me" is a clear, not a block.** They can message you again, and the thread returns.
- **"Delete chat for everyone" is permanent**, destroys both copies, and either participant may do it. There is no undo and no time limit.
- **Uploads are never garbage-collected**, even when the message referencing them is deleted.
- **One-to-one only.** No group chats — a conversation has exactly two participants, enforced by the schema.

## Deployment

The backend holds long-lived WebSocket connections, so it **cannot** run on a serverless platform. Vercel is fine for the Next.js client but not for the chat server.

**Backend → Render / Railway / Fly.io**

| Setting | Value |
|---|---|
| Root directory | `server` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Environment | `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN` (your deployed client URL) |

**Frontend → Render or Vercel**

| Setting | Value |
|---|---|
| Root directory | `client` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Environment | `NEXT_PUBLIC_CHAT_SERVER_URL` (your deployed server URL) |

**Do not set `PORT`.** The host injects it, and the server reads it. Hard-coding one is how you get "No open ports detected".

`NEXT_PUBLIC_` variables are read at **build** time, so `NEXT_PUBLIC_CHAT_SERVER_URL` must be set *before* the client build runs — not after.

### Why there is an `.npmrc` in each service

Render (like most hosts) sets `NODE_ENV=production`, and npm then **skips `devDependencies` entirely**. But both builds need them: `typescript` and every `@types/*` package for the server, `typescript` + `tailwindcss` + `postcss` for the client.

Without `include=dev` the server deploy fails with a genuinely misleading error:

```
error TS2688: Cannot find type definition file for 'node'
```

— not "tsc: not found", because `@types/node` happens to arrive transitively via a runtime package while TypeScript itself does not. The `.npmrc` affects **install only**; nothing extra ships to the running service, since the build compiles TypeScript away.

Set `CLIENT_ORIGIN` on the server to the deployed client URL, or the browser's requests will be blocked by CORS.

---

## Troubleshooting

**`querySrv ECONNREFUSED` when connecting to MongoDB Atlas.**
A `mongodb+srv://` URI requires an SRV DNS lookup, which Node performs against the DNS server your OS advertises — *not* via the normal hostname resolver. If that DNS server is unreachable (a common symptom is your system DNS being set to `127.0.0.1` with nothing listening there), the lookup is refused even though ordinary web traffic and `npm install` work fine.

Either fix the machine's DNS, or use Atlas's non-SRV connection string (`mongodb://host1,host2,host3/…?ssl=true&replicaSet=…`), which skips the SRV lookup entirely. Atlas offers it under *Connect → Drivers → Node.js 2.2.12 or later*.

**The server refuses to start, complaining about `JWT_SECRET`.**
It must be at least 16 characters. Deliberate: a server that booted without a usable secret would accept every connection and then reject it with a `401`, which is a miserable thing to debug.

**The socket never connects, but REST works.**
Check `CLIENT_ORIGIN` matches the origin the browser is actually on. Express CORS and Socket.io CORS are configured separately — both read `CLIENT_ORIGIN`, but they are different systems and setting only one gives you exactly this symptom. Also, `NEXT_PUBLIC_` variables are read at **build** time, so rebuild the client after changing `NEXT_PUBLIC_CHAT_SERVER_URL`.

**"You can only message people who follow you back."**
Working as intended — you follow them, but they have not followed you back yet.
