/**
 * Wrapper for a page body that arrives behind a `<Suspense>` fallback.
 *
 * The dashboard's shell paints ~60ms after a click and the body replaces its
 * skeleton ~300ms later, and that swap is abrupt: one frame of grey blocks,
 * the next of real content. React enforces most of that 300ms itself —
 * `FALLBACK_THROTTLE_MS` holds the reveal so a fallback that has just appeared
 * cannot flash away — so the gap is not something a faster server removes. See
 * docs/PERFORMANCE.md.
 *
 * What is left to improve is the transition, so the content fades in over the
 * skeleton's position instead of snapping into it. Short and subtle on
 * purpose: long enough to read as one movement, short enough that it never
 * delays anyone.
 *
 * `motion-reduce:animate-none` drops the animation entirely for anyone who has
 * asked their OS for reduced motion — the content still appears at the same
 * moment, just without the fade.
 */
export default function Streamed({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none" +
        (className ? ` ${className}` : "")
      }
    >
      {children}
    </div>
  );
}
