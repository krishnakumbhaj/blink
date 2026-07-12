/**
 * End-to-end verification of the whole backend.
 *
 * Boots an ephemeral MongoDB, starts the REAL server entrypoint as a child
 * process, then drives it exactly as three browsers would: register, search,
 * follow, open a conversation, and exchange messages over live Socket.io
 * connections. Nothing is mocked.
 *
 * Cast: ana and ben become mutuals and chat. cara is the outsider — she exists
 * to prove that a third party can neither read the thread nor receive its
 * messages over her socket.
 *
 *   npm run test:e2e
 */
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';
import { io, type Socket } from 'socket.io-client';

const PORT = 5099;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'test-secret-that-is-long-enough-to-pass';
const EVENT_TIMEOUT_MS = 10_000;

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = EVENT_TIMEOUT_MS): Promise<T> {
  return waitForMatch<T>(socket, event, () => true, timeoutMs);
}

/** Resolves with the first occurrence of `event` satisfying `predicate`. */
function waitForMatch<T>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean,
  timeoutMs = EVENT_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onEvent = (payload: T) => {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for a matching "${event}"`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
    };
    socket.on(event, onEvent);
  });
}

/** Asserts an event does NOT arrive within the window. Used for isolation checks. */
function expectNoEvent(socket: Socket, event: string, windowMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const onEvent = () => {
      cleanup();
      resolve(false); // it fired — that is a leak
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(true); // silence — correct
    }, windowMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
    };
    socket.on(event, onEvent);
  });
}

/** `Response.json()` is typed as `unknown`, so callers declare what they expect. */
async function api<T = unknown>(
  pathname: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

interface Envelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}
interface Identity {
  token: string;
  id: string;
  username: string;
}
interface UserDTO {
  id: string;
  username: string;
  avatarUrl: string | null;
  isFollowing: boolean;
  followsYou: boolean;
  isMutual: boolean;
  requestSent: boolean;
  requestReceived: boolean;
}
interface AttachmentDTO {
  key: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
  isImage: boolean;
}
interface MessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  attachments: AttachmentDTO[];
  forwarded: boolean;
  deletedForEveryone: boolean;
  delivered: boolean;
  read: boolean;
  createdAt: string;
}

type UploadDTO = AttachmentDTO;

/** The smallest valid PNG there is: 1×1, transparent. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Uploads one or many files. The endpoint always returns an array. */
async function uploadFiles(
  who: Identity,
  files: { buffer: Buffer; contentType?: string; name?: string }[]
): Promise<{ status: number; body: Envelope<UploadDTO[]> }> {
  const form = new FormData();
  for (const file of files) {
    const type = file.contentType ?? 'image/png';
    form.append(
      'files',
      new Blob([new Uint8Array(file.buffer)], { type }),
      file.name ?? 'pic.png'
    );
  }

  const response = await fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${who.token}` },
    body: form,
  });

  return { status: response.status, body: (await response.json()) as Envelope<UploadDTO[]> };
}

/** Convenience: upload a single file and return its record. */
async function uploadOne(
  who: Identity,
  buffer: Buffer,
  contentType = 'image/png',
  name = 'pic.png'
) {
  const res = await uploadFiles(who, [{ buffer, contentType, name }]);
  return { status: res.status, body: { ...res.body, data: res.body.data?.[0] } };
}
interface ConversationDTO {
  id: string;
  otherUser: UserDTO;
  lastMessage: { text: string } | null;
  unreadCount: number;
}

async function register(username: string): Promise<Identity> {
  const res = await api<Envelope<{ token: string; user: { id: string; username: string } }>>(
    '/api/auth/register',
    {
      method: 'POST',
      body: { username, email: `${username}@test.dev`, password: 'password123' },
    }
  );
  if (!res.body.data) throw new Error(`Could not register ${username}: ${res.body.message}`);
  return { token: res.body.data.token, id: res.body.data.user.id, username };
}

/** Ask to follow. Becomes a request unless they already follow you. */
const follow = (me: Identity, target: Identity) =>
  api<Envelope<{ relationship: UserDTO; accepted: boolean }>>(
    `/api/users/${target.id}/follow`,
    { token: me.token, method: 'POST' }
  );

const unfollow = (me: Identity, target: Identity) =>
  api<Envelope<UserDTO>>(`/api/users/${target.id}/follow`, { token: me.token, method: 'DELETE' });

const cancelRequest = (me: Identity, target: Identity) =>
  api<Envelope<UserDTO>>(`/api/users/${target.id}/request`, { token: me.token, method: 'DELETE' });

const accept = (me: Identity, requester: Identity) =>
  api<Envelope<UserDTO>>(`/api/users/${requester.id}/accept`, { token: me.token, method: 'POST' });

const decline = (me: Identity, requester: Identity) =>
  api<Envelope<UserDTO>>(`/api/users/${requester.id}/decline`, { token: me.token, method: 'POST' });

const incomingRequests = (me: Identity) =>
  api<Envelope<UserDTO[]>>('/api/users/requests', { token: me.token });


const openConversation = (me: Identity, target: Identity) =>
  api<Envelope<ConversationDTO>>('/api/conversations', {
    token: me.token,
    method: 'POST',
    body: { userId: target.id },
  });

const getHistory = (me: Identity, conversationId: string) =>
  api<Envelope<MessageDTO[]>>(`/api/conversations/${conversationId}/messages`, { token: me.token });

const inbox = (me: Identity) =>
  api<Envelope<ConversationDTO[]>>('/api/conversations', { token: me.token });

const deleteMessage = (
  me: Identity,
  conversationId: string,
  messageId: string,
  scope: 'me' | 'everyone'
) =>
  api<Envelope<unknown>>(
    `/api/conversations/${conversationId}/messages/${messageId}?scope=${scope}`,
    { token: me.token, method: 'DELETE' }
  );

const forward = (me: Identity, messageId: string, conversationIds: string[]) =>
  api<Envelope<MessageDTO[]>>('/api/conversations/forward', {
    token: me.token,
    method: 'POST',
    body: { messageId, conversationIds },
  });

const deleteChat = (me: Identity, conversationId: string, scope: 'me' | 'everyone') =>
  api<Envelope<unknown>>(`/api/conversations/${conversationId}?scope=${scope}`, {
    token: me.token,
    method: 'DELETE',
  });

const send = (
  me: Identity,
  conversationId: string,
  body: string | { text?: string; attachmentKeys?: string[] }
) =>
  api<Envelope<MessageDTO>>(`/api/conversations/${conversationId}/messages`, {
    token: me.token,
    method: 'POST',
    body: typeof body === 'string' ? { text: body } : body,
  });

function connect(who: Identity): Socket {
  return io(BASE, { auth: { token: who.token }, transports: ['websocket'] });
}

async function waitForHealth(retries = 60): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Server never became healthy');
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('viboz-chat-test');

  let server: ChildProcess | undefined;
  const sockets: Socket[] = [];

  try {
    // No shell: a shell-spawned child means kill() only kills the shell, leaving
    // an orphan holding the port for the next run to health-check green against.
    server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: String(PORT),
        MONGODB_URI: uri,
        JWT_SECRET: SECRET,
        CLIENT_ORIGIN: 'http://localhost:3000',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (c) => process.stderr.write(`  [server] ${c}`));

    const reap = () => server?.kill('SIGKILL');
    process.once('exit', reap);
    process.once('SIGINT', reap);

    await waitForHealth();
    console.log('\nServer is up. Running checks.\n');

    // ---------------------------------------------------------------- accounts
    console.log('Accounts');
    const ana = await register('ana');
    const ben = await register('ben');
    const cara = await register('cara');
    check('Three accounts register and receive tokens', Boolean(ana.token && ben.token && cara.token));

    const dupe = await api('/api/auth/register', {
      method: 'POST',
      body: { username: 'ana', email: 'x@test.dev', password: 'password123' },
    });
    check('Duplicate username is rejected with 409', dupe.status === 409, `got ${dupe.status}`);

    const wrongPw = await api<Envelope<never>>('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'ana', password: 'nope' },
    });
    const ghost = await api<Envelope<never>>('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'ghost', password: 'password123' },
    });
    check(
      'Unknown user and wrong password give an identical error (no account enumeration)',
      wrongPw.status === ghost.status && wrongPw.body.message === ghost.body.message
    );

    // ---------------------------------------------------------------- discovery
    console.log('\nFinding people by username');
    const search = await api<Envelope<UserDTO[]>>('/api/users/search?q=be', { token: ana.token });
    check('Search by username prefix finds ben', search.body.data?.some((u) => u.username === 'ben') === true);
    check('Search never returns yourself', search.body.data?.every((u) => u.id !== ana.id) === true);

    const selfSearch = await api<Envelope<UserDTO[]>>('/api/users/search?q=ana', { token: ana.token });
    check('Searching your own name returns nothing', selfSearch.body.data?.length === 0);

    const injection = await api<Envelope<UserDTO[]>>('/api/users/search?q=.%2A', { token: ana.token });
    check(
      'A regex in the query is escaped, not executed (".*" matches nobody)',
      injection.body.data?.length === 0,
      `".*" returned ${injection.body.data?.length} users`
    );

    // ---------------------------------------------------------------- the rule
    console.log('\nFollow requests');
    const strangerChat = await openConversation(ana, ben);
    check('Cannot open a chat with a stranger (403)', strangerChat.status === 403, `got ${strangerChat.status}`);

    const asked = await follow(ana, ben);
    check('Following someone new creates a PENDING request, not a follow', asked.body.data?.accepted === false);
    check('...and reports requestSent', asked.body.data?.relationship.requestSent === true);
    check('...and does NOT make Ana a follower yet', asked.body.data?.relationship.isFollowing === false);

    const benRequests = await incomingRequests(ben);
    check('Ben sees Ana in his incoming requests', benRequests.body.data?.some((u) => u.username === 'ana') === true);
    check('The request shows as requestReceived to Ben', benRequests.body.data?.[0].requestReceived === true);

    const twice = await follow(ana, ben);
    check('Asking twice does not create a second request', twice.body.data?.relationship.requestSent === true);

    const pendingChat = await openConversation(ana, ben);
    check('A pending request does NOT unlock chat (403)', pendingChat.status === 403, `got ${pendingChat.status}`);

    // Withdraw, then re-ask — the cancel path has to actually work.
    await cancelRequest(ana, ben);
    const afterCancel = await incomingRequests(ben);
    check('Cancelling a request removes it from their list', afterCancel.body.data?.length === 0);
    await follow(ana, ben);

    // Cara asks Ben too, and gets turned down.
    await follow(cara, ben);
    await decline(ben, cara);
    const afterDecline = await incomingRequests(ben);
    check('A declined request disappears', afterDecline.body.data?.some((u) => u.username === 'cara') === false);
    const caraRel = await api<Envelope<UserDTO>>(`/api/users/${ben.id}`, { token: cara.token });
    check('Declining leaves no follow behind', caraRel.body.data?.isFollowing === false);

    // Ben accepts Ana.
    const accepted = await accept(ben, ana);
    check('Accepting makes the requester a follower', accepted.body.data?.followsYou === true);
    check('...but does NOT auto-follow them back', accepted.body.data?.isFollowing === false);

    const oneWayChat = await openConversation(ana, ben);
    check(
      'A one-way follow is still NOT enough to chat (403)',
      oneWayChat.status === 403,
      `got ${oneWayChat.status}`
    );

    /**
     * Following back is a request like any other — there is NO auto-accept, even
     * though Ana already follows Ben. Every follow needs approval, in both
     * directions, so opening a chat is a four-step handshake.
     */
    const followBack = await follow(ben, ana);
    check('Following back is NOT auto-accepted — it raises a request', followBack.body.data?.accepted === false);
    check('...so the pair is not mutual yet', followBack.body.data?.relationship.isMutual === false);

    const anaRequests = await incomingRequests(ana);
    check('Ana now has a request from ben', anaRequests.body.data?.some((u) => u.username === 'ben') === true);

    const stillBlocked = await openConversation(ana, ben);
    check('Chat is STILL locked until she accepts (403)', stillBlocked.status === 403, `got ${stillBlocked.status}`);

    const finalAccept = await accept(ana, ben);
    check('Ana accepting completes the mutual', finalAccept.body.data?.isMutual === true);

    const mutuals = await api<Envelope<UserDTO[]>>('/api/users/mutuals', { token: ana.token });
    check('Ben now appears in Ana\'s mutuals', mutuals.body.data?.some((u) => u.username === 'ben') === true);

    const following = await api<Envelope<UserDTO[]>>('/api/users/following', { token: ana.token });
    const followers = await api<Envelope<UserDTO[]>>('/api/users/followers', { token: ana.token });
    check('Ana\'s following list contains ben', following.body.data?.some((u) => u.username === 'ben') === true);
    check('Ana\'s followers list contains ben', followers.body.data?.some((u) => u.username === 'ben') === true);

    const opened = await openConversation(ana, ben);
    check('Chat unlocks once both follow each other (201)', opened.status === 201, `got ${opened.status}`);

    const conversationId = opened.body.data!.id;

    const reopened = await openConversation(ben, ana);
    check(
      'Opening from the other side returns the SAME conversation, not a duplicate',
      reopened.body.data?.id === conversationId
    );

    // ---------------------------------------------------------------- sockets
    console.log('\nReal-time delivery (the mandatory bit)');
    const anaSocket = connect(ana);
    const benSocket = connect(ben);
    const caraSocket = connect(cara);
    sockets.push(anaSocket, benSocket, caraSocket);

    await Promise.all([
      waitFor(anaSocket, 'connect'),
      waitFor(benSocket, 'connect'),
      waitFor(caraSocket, 'connect'),
    ]);
    check('All three sockets connect with their tokens', true);

    const benReceives = waitFor<MessageDTO>(benSocket, 'message:new');
    const caraStaysSilent = expectNoEvent(caraSocket, 'message:new');

    // Attach BEFORE sending. The server emits message:new and conversation:update
    // back to back, so a listener attached after awaiting the first one would
    // miss the second entirely.
    const benInboxUpdate = waitForMatch<ConversationDTO>(
      benSocket,
      'conversation:update',
      (c) => c.id === conversationId
    );

    const sent = await send(ana, conversationId, 'Hello Ben');
    check('POST message returns 201', sent.status === 201, `got ${sent.status}`);

    const delivered = await benReceives;
    check('Ben receives the message over his socket, no refresh', delivered.text === 'Hello Ben');
    check('It is marked delivered (Ben was online)', delivered.delivered === true);
    check('THE ISOLATION CHECK: cara never receives it', await caraStaysSilent);

    const benInbox = await benInboxUpdate;
    check('Ben\'s inbox row updates live with the last message', benInbox.lastMessage?.text === 'Hello Ben');
    check('...and shows an unread badge of 1', benInbox.unreadCount === 1, `got ${benInbox.unreadCount}`);

    // ---------------------------------------------------------------- files
    console.log('\nAttachments');
    const uploaded = await uploadOne(ana, TINY_PNG);
    check('Uploading a file returns 201 and a key', uploaded.status === 201 && Boolean(uploaded.body.data?.key));

    const imageKey = uploaded.body.data!.key;
    check('The key is a random 32-hex handle, NOT a guessable ObjectId', /^[0-9a-f]{32}$/.test(imageKey));
    check('An image is flagged isImage', uploaded.body.data!.isImage === true);

    const fetched = await fetch(`${BASE}${uploaded.body.data!.url}`);
    const bytes = Buffer.from(await fetched.arrayBuffer());
    check('It serves back byte-for-byte', bytes.equals(TINY_PNG));
    check('...with the right content type', fetched.headers.get('content-type') === 'image/png');
    check('...inline, because it is a safe image', fetched.headers.get('content-disposition') === 'inline');
    check('...and nosniff', fetched.headers.get('x-content-type-options') === 'nosniff');

    // The security decision: dangerous types are not rejected, they are forced to
    // DOWNLOAD. A downloaded SVG cannot run script against our origin.
    const svg = await uploadOne(ana, Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml', 'x.svg');
    check('An SVG can be uploaded as a file', svg.status === 201, `got ${svg.status}`);
    check('...but is NOT treated as an inline image', svg.body.data!.isImage === false);

    const svgFetched = await fetch(`${BASE}${svg.body.data!.url}`);
    check(
      'THE XSS GUARD: it is served as a forced download, never inline',
      svgFetched.headers.get('content-disposition')?.startsWith('attachment') === true,
      `got "${svgFetched.headers.get('content-disposition')}"`
    );
    check(
      '...and its content-type is neutralised to octet-stream',
      svgFetched.headers.get('content-type') === 'application/octet-stream'
    );

    const pdf = await uploadOne(ana, Buffer.from('%PDF-1.4 fake'), 'application/pdf', 'report.pdf');
    check('A document uploads fine', pdf.status === 201);
    const pdfFetched = await fetch(`${BASE}${pdf.body.data!.url}`);
    check(
      'It downloads under its ORIGINAL filename',
      pdfFetched.headers.get('content-disposition')?.includes('report.pdf') === true
    );

    const missingImage = await fetch(`${BASE}/api/uploads/${'0'.repeat(32)}`);
    check('An unknown key 404s', missingImage.status === 404);

    // --- many files on one message ---
    const many = await uploadFiles(ana, [
      { buffer: TINY_PNG, name: 'a.png' },
      { buffer: TINY_PNG, name: 'b.png' },
      { buffer: Buffer.from('%PDF-1.4 fake'), contentType: 'application/pdf', name: 'c.pdf' },
    ]);
    check('Three files upload in ONE request', many.status === 201 && many.body.data?.length === 3);

    const benReceivesFiles = waitFor<MessageDTO>(benSocket, 'message:new');
    const multi = await send(ana, conversationId, {
      text: 'here you go',
      attachmentKeys: many.body.data!.map((u) => u.key),
    });
    check('A message can carry MULTIPLE attachments', multi.status === 201, `got ${multi.status}`);
    check('...all three come back', multi.body.data?.attachments.length === 3);
    check('...in the order they were sent', multi.body.data?.attachments[2].name === 'c.pdf');
    check('...with images and files distinguished', multi.body.data?.attachments.filter((a) => a.isImage).length === 2);

    const filesDelivered = await benReceivesFiles;
    check('Ben receives them over his socket', filesDelivered.attachments.length === 3);

    const bareImage = await send(ana, conversationId, { attachmentKeys: [imageKey] });
    check('An attachment with no caption is allowed', bareImage.status === 201, `got ${bareImage.status}`);

    const emptyMsg = await send(ana, conversationId, { attachmentKeys: [] });
    check('...but a message with neither text nor files is not', emptyMsg.status === 400, `got ${emptyMsg.status}`);

    // Cara uploads her own file, then Ana tries to attach CARA's key.
    const caraUpload = await uploadOne(cara, TINY_PNG);
    check('Cara can upload her own file', caraUpload.status === 201);

    const stolen = await send(ana, conversationId, { attachmentKeys: [caraUpload.body.data!.key] });
    check(
      "You cannot attach someone ELSE's upload key (403)",
      stolen.status === 403,
      `got ${stolen.status}`
    );

    const mixedTheft = await send(ana, conversationId, {
      attachmentKeys: [imageKey, caraUpload.body.data!.key],
    });
    check(
      '...not even smuggled in among your own files',
      mixedTheft.status === 403,
      `got ${mixedTheft.status} — ownership must be checked on EVERY key, not just the first`
    );

    const noAuthUpload = await fetch(`${BASE}/api/uploads`, { method: 'POST' });
    check('Uploading without a token is rejected', noAuthUpload.status === 401);

    // ---------------------------------------------------------------- avatars
    console.log('\nProfile photos');
    const avatarUpload = await uploadOne(ben, TINY_PNG);
    const setAvatar = await api<Envelope<{ avatarUrl: string | null }>>('/api/users/me/avatar', {
      token: ben.token,
      method: 'PATCH',
      body: { avatarKey: avatarUpload.body.data!.key },
    });
    check('Setting a profile photo returns the new avatarUrl', Boolean(setAvatar.body.data?.avatarUrl));

    const anaSeesBen = await api<Envelope<UserDTO>>(`/api/users/${ben.id}`, { token: ana.token });
    check('Ana sees Ben\'s photo on his profile', anaSeesBen.body.data?.avatarUrl === setAvatar.body.data?.avatarUrl);

    const inboxWithAvatar = await api<Envelope<ConversationDTO[]>>('/api/conversations', { token: ana.token });
    check('...and in her inbox row for him', Boolean(inboxWithAvatar.body.data?.[0].otherUser.avatarUrl));

    const stolenAvatar = await api('/api/users/me/avatar', {
      token: cara.token,
      method: 'PATCH',
      body: { avatarKey: avatarUpload.body.data!.key },
    });
    check(
      'You cannot set someone else\'s upload as YOUR avatar (403)',
      stolenAvatar.status === 403,
      `got ${stolenAvatar.status}`
    );

    const pdfAvatar = await api('/api/users/me/avatar', {
      token: ana.token,
      method: 'PATCH',
      body: { avatarKey: pdf.body.data!.key },
    });
    check(
      'A PDF cannot be used as a profile photo (415)',
      pdfAvatar.status === 415,
      `got ${pdfAvatar.status}`
    );

    const cleared = await api<Envelope<{ avatarUrl: string | null }>>('/api/users/me/avatar', {
      token: ben.token,
      method: 'PATCH',
      body: { avatarKey: null },
    });
    check('Clearing the photo falls back to null', cleared.body.data?.avatarUrl === null);

    // ---------------------------------------------------------------- privacy
    console.log('\nA third party cannot get in');
    const caraReads = await api(`/api/conversations/${conversationId}/messages`, { token: cara.token });
    check('Cara cannot read the thread (404, not 403 — no existence leak)', caraReads.status === 404, `got ${caraReads.status}`);

    const caraSends = await send(cara, conversationId, 'let me in');
    check('Cara cannot post into the thread', caraSends.status === 404, `got ${caraSends.status}`);

    const caraInbox = await api<Envelope<ConversationDTO[]>>('/api/conversations', { token: cara.token });
    check('Cara\'s inbox is empty', caraInbox.body.data?.length === 0);

    // ---------------------------------------------------------------- history
    console.log('\nPersistence across refresh');
    const history = await api<Envelope<MessageDTO[]>>(
      `/api/conversations/${conversationId}/messages`,
      { token: ben.token }
    );
    const stored = history.body.data ?? [];

    // Three by now: "Hello Ben", the captioned photo, and the bare photo.
    check('History returns every stored message', stored.length === 3, `got ${stored.length}`);
    check('...oldest first', stored[0].text === 'Hello Ben');
    check('Message carries a timestamp', !Number.isNaN(Date.parse(stored[0].createdAt)));
    check('Persisted id matches the broadcast id', stored[0].id === delivered.id);
    check('Attachment messages survive the refresh too', stored.filter((m) => m.attachments.length > 0).length === 2);

    // ---------------------------------------------------------------- typing
    console.log('\nTyping indicator');
    const benSeesTyping = waitFor<{ conversationId: string; username: string; isTyping: boolean }>(
      benSocket,
      'typing:update'
    );
    const caraSeesNoTyping = expectNoEvent(caraSocket, 'typing:update');

    anaSocket.emit('typing:start', { conversationId });
    const typing = await benSeesTyping;
    check('Ben sees Ana typing, scoped to this conversation', typing.isTyping && typing.username === 'ana');
    check('Cara does not see it', await caraSeesNoTyping);

    // ---------------------------------------------------------------- receipts
    console.log('\nRead receipts');
    const anaSeesRead = waitFor<{ conversationId: string; ids: string[]; read: boolean }>(
      anaSocket,
      'message:status'
    );
    benSocket.emit('message:read', { conversationId });
    const status = await anaSeesRead;
    check('Ana is told Ben read it', status.read === true && status.ids.includes(delivered.id));

    const clearedInbox = await api<Envelope<ConversationDTO[]>>('/api/conversations', { token: ben.token });
    check('Ben\'s unread badge is cleared', clearedInbox.body.data?.[0].unreadCount === 0);

    // ---------------------------------------------------------------- unfollow
    console.log('\nUnfollowing closes the door again');
    await unfollow(ben, ana);
    const afterUnfollow = await send(ana, conversationId, 'still there?');
    check(
      'Sending is blocked once they unfollow you, even though the thread exists',
      afterUnfollow.status === 403,
      `got ${afterUnfollow.status}`
    );

    const stillReadable = await api(`/api/conversations/${conversationId}/messages`, { token: ana.token });
    check('The existing history is still readable', stillReadable.status === 200);

    // ---------------------------------------------------------------- validation
    console.log('\nValidation, auth & CORS');

    // Restore the mutual: request, then accept. No shortcuts.
    await follow(ben, ana);
    const restored = await accept(ana, ben);
    check('Re-following after an unfollow needs a fresh request + accept', restored.body.data?.isMutual === true);

    const empty = await send(ana, conversationId, '   ');
    check('Empty message rejected with 400', empty.status === 400, `got ${empty.status}`);

    const tooLong = await send(ana, conversationId, 'x'.repeat(2001));
    check('Over-long message rejected with 400', tooLong.status === 400, `got ${tooLong.status}`);

    const noToken = await api('/api/conversations');
    check('REST rejects a request with no token', noToken.status === 401);

    const forged = jwt.sign({ username: 'mallory' }, 'wrong-secret', { subject: 'x' });
    const badToken = await api('/api/conversations', { token: forged });
    check('REST rejects a token signed with the wrong secret', badToken.status === 401);

    const rejected = io(BASE, { auth: { token: 'garbage' }, transports: ['websocket'] });
    sockets.push(rejected);
    check('Socket handshake rejects an invalid token', (await waitFor(rejected, 'connect_error').catch(() => null)) !== null);

    const allowed = await fetch(`${BASE}/api/conversations`, {
      headers: { Origin: 'http://localhost:3000', Authorization: `Bearer ${ana.token}` },
    });
    check(
      'Allowed origin gets an Access-Control-Allow-Origin header',
      allowed.headers.get('access-control-allow-origin') === 'http://localhost:3000'
    );

    const blocked = await fetch(`${BASE}/api/conversations`, {
      headers: { Origin: 'http://evil.example', Authorization: `Bearer ${ana.token}` },
    });
    check(
      'Disallowed origin gets NO Access-Control-Allow-Origin header',
      blocked.headers.get('access-control-allow-origin') === null
    );

    // ---------------------------------------------------------------- presence
    console.log('\nPresence & disconnect');
    const anaSeesBenLeave = waitForMatch<{ online: { username: string }[] }>(
      anaSocket,
      'presence:update',
      (p) => !p.online.some((u) => u.username === 'ben')
    );
    benSocket.close();
    const afterLeave = await anaSeesBenLeave;
    check('Ben disappears from the roster on disconnect', !afterLeave.online.some((u) => u.username === 'ben'));
    check('Ana is still online', afterLeave.online.some((u) => u.username === 'ana'));

    const offlineSend = await send(ana, conversationId, 'you there?');
    check(
      'A message to an offline user is saved but NOT marked delivered',
      offlineSend.body.data?.delivered === false,
      `delivered=${offlineSend.body.data?.delivered}`
    );

    // ---------------------------------------------------------------- forwarding
    console.log('\nForwarding');

    // Ana needs a SECOND chat to forward into. dave becomes her mutual.
    const dave = await register('dave');
    await follow(ana, dave);
    await accept(dave, ana);
    await follow(dave, ana);
    await accept(ana, dave);

    const daveChat = await openConversation(ana, dave);
    const daveConversationId = daveChat.body.data!.id;

    const daveSocket = connect(dave);
    sockets.push(daveSocket);
    await waitFor(daveSocket, 'connect');

    const daveReceives = waitFor<MessageDTO>(daveSocket, 'message:new');

    // Forward BEN's message (with his attachments) into the chat with dave. The
    // uploads belong to ana here, but the principle is the same: the attachment
    // metadata is copied from a message we are allowed to read.
    const sourceId = filesDelivered.id;
    const fwd = await forward(ana, sourceId, [daveConversationId]);
    check('Forwarding returns 201', fwd.status === 201, `got ${fwd.status}`);
    check('...and creates one message per target', fwd.body.data?.length === 1);
    check('...marked as forwarded', fwd.body.data?.[0].forwarded === true);
    check('...carrying the original text', fwd.body.data?.[0].text === 'here you go');
    check(
      'ATTACHMENTS ARE RE-USED, not re-uploaded',
      fwd.body.data?.[0].attachments.length === 3 &&
        fwd.body.data![0].attachments[0].key === filesDelivered.attachments[0].key,
      'the forwarded copy should point at the SAME upload keys'
    );

    const daveGot = await daveReceives;
    check('Dave receives it over his socket', daveGot.forwarded === true);
    check('...into the right conversation', daveGot.conversationId === daveConversationId);

    const original = (await getHistory(ana, conversationId)).body.data!;
    check(
      'The original is untouched — a forward is a copy, not a move',
      original.some((m) => m.id === sourceId && !m.forwarded)
    );

    // --- authorisation ---
    const caraForward = await forward(cara, sourceId, [daveConversationId]);
    check(
      'You cannot forward a message from a thread you are not in (404)',
      caraForward.status === 404,
      `got ${caraForward.status}`
    );

    const strangerTarget = await forward(ana, sourceId, [conversationId, 'ffffffffffffffffffffffff']);
    check(
      'Forwarding to a conversation you are not in is rejected',
      strangerTarget.status === 404 || strangerTarget.status === 400,
      `got ${strangerTarget.status}`
    );

    const emptyTargets = await forward(ana, sourceId, []);
    check('Forwarding to no chats at all is rejected (400)', emptyTargets.status === 400, `got ${emptyTargets.status}`);

    // --- download ---
    console.log('\nDownloading media');
    const inlineUrl = `${BASE}${uploaded.body.data!.url}`;

    const asInline = await fetch(inlineUrl);
    check('A photo serves inline by default', asInline.headers.get('content-disposition') === 'inline');

    const asDownload = await fetch(`${inlineUrl}?download=1`);
    check(
      '?download=1 forces it to save instead',
      asDownload.headers.get('content-disposition')?.startsWith('attachment') === true,
      `got "${asDownload.headers.get('content-disposition')}"`
    );
    check(
      '...under its original filename',
      asDownload.headers.get('content-disposition')?.includes('pic.png') === true
    );
    check(
      '...and the bytes are still the same file',
      Buffer.from(await asDownload.arrayBuffer()).equals(TINY_PNG)
    );

    // ---------------------------------------------------------------- deletion
    console.log('\nDeleting messages');

    // Ben went offline above; bring him back — the point of a retraction is that
    // the OTHER person's screen changes.
    const ben2 = connect(ben);
    sockets.push(ben2);
    await waitFor(ben2, 'connect');

    const before = (await getHistory(ana, conversationId)).body.data!;
    const anaMessage = before.find((m) => m.senderId === ana.id && m.text === 'Hello Ben')!;
    const bareImage2 = before.find((m) => m.attachments.length > 0 && !m.text)!;

    // --- delete for me ---
    const delMine = await deleteMessage(ana, conversationId, bareImage2.id, 'me');
    check('Delete-for-me returns 200', delMine.status === 200, `got ${delMine.status}`);

    const anaAfter = (await getHistory(ana, conversationId)).body.data!;
    check('...it disappears from MY history', !anaAfter.some((m) => m.id === bareImage2.id));

    const benAfter = (await getHistory(ben, conversationId)).body.data!;
    check(
      'THE ASYMMETRY: it is still there for THEM',
      benAfter.some((m) => m.id === bareImage2.id),
      'a delete-for-me deleted it for both — that is a data-loss bug'
    );

    // --- only the sender may retract ---
    const notMine = await deleteMessage(ben, conversationId, anaMessage.id, 'everyone');
    check(
      'You cannot delete SOMEONE ELSE\'s message for everyone (403)',
      notMine.status === 403,
      `got ${notMine.status} — a recipient could erase what you said to them`
    );

    // --- delete for everyone ---
    const benSeesDeletion = waitForMatch<{ conversationId: string; id: string }>(
      ben2,
      'message:deleted',
      (p) => p.id === anaMessage.id
    );

    const retract = await deleteMessage(ana, conversationId, anaMessage.id, 'everyone');
    check('The sender CAN retract their own message', retract.status === 200, `got ${retract.status}`);
    check('Ben is told over the socket, live', Boolean(await benSeesDeletion));

    const benSees = (await getHistory(ben, conversationId)).body.data!;
    const tombstone = benSees.find((m) => m.id === anaMessage.id);
    check('The message survives as a tombstone, not a hole', Boolean(tombstone));
    check('...flagged as deleted', tombstone?.deletedForEveryone === true);
    check('...with the content actually GONE, not merely hidden', tombstone?.text === '' && tombstone?.attachments.length === 0);

    const badScope = await api(`/api/conversations/${conversationId}/messages/${anaMessage.id}?scope=nuke`, {
      token: ana.token,
      method: 'DELETE',
    });
    check('An unknown scope is rejected (400)', badScope.status === 400, `got ${badScope.status}`);

    // ---------------------------------------------------------------- chats
    console.log('\nDeleting a chat');

    const clear = await deleteChat(ben, conversationId, 'me');
    check('Delete-chat-for-me returns 200', clear.status === 200, `got ${clear.status}`);

    check('...the chat leaves MY inbox', (await inbox(ben)).body.data?.length === 0);
    check('...and its history is cleared for me', (await getHistory(ben, conversationId)).body.data?.length === 0);
    check(
      'THE ASYMMETRY: their inbox is untouched',
      (await inbox(ana)).body.data?.some((c) => c.id === conversationId) === true
    );
    check('...and so is their history', ((await getHistory(ana, conversationId)).body.data?.length ?? 0) > 0);

    // A cleared chat is not a block: a new message brings it back.
    await send(ana, conversationId, 'you back?');
    const revived = (await inbox(ben)).body.data!;
    check('A new message revives the cleared chat', revived.some((c) => c.id === conversationId));

    const revivedHistory = (await getHistory(ben, conversationId)).body.data!;
    check('...showing ONLY what arrived after the clear', revivedHistory.length === 1 && revivedHistory[0].text === 'you back?');

    // --- delete for everyone ---
    const benSeesChatGone = waitForMatch<{ conversationId: string }>(
      ben2,
      'conversation:deleted',
      (p) => p.conversationId === conversationId
    );

    const nuke = await deleteChat(ana, conversationId, 'everyone');
    check('Delete-chat-for-everyone returns 200', nuke.status === 200, `got ${nuke.status}`);
    check('Ben is told over the socket, live', Boolean(await benSeesChatGone));

    // Ana also has a chat with dave (from the forwarding tests), so her inbox is
    // not empty — assert THIS conversation is gone, not that everything is.
    const anaAfterNuke = (await inbox(ana)).body.data ?? [];
    const benAfterNuke = (await inbox(ben)).body.data ?? [];
    check(
      'It is gone from BOTH inboxes',
      !anaAfterNuke.some((c) => c.id === conversationId) &&
        !benAfterNuke.some((c) => c.id === conversationId)
    );
    check(
      '...while their OTHER chats are left alone',
      anaAfterNuke.some((c) => c.id === daveConversationId),
      'deleting one chat must not take the others with it'
    );
    check('The thread itself 404s', (await getHistory(ana, conversationId)).status === 404);
  } finally {
    for (const s of sockets) s.close();
    server?.kill('SIGKILL');
    await mongo.stop();
  }

  console.log(`\n${'-'.repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nHarness crashed:', err);
  process.exit(1);
});
