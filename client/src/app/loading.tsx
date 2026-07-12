import CircularLoader from '@/components/CircularLoader';

/** Route-level loading UI, shown by Next while a segment streams in. */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <CircularLoader />
    </div>
  );
}
