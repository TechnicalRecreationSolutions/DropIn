/**
 * Minimal layout for the widget iframe route.
 * The root layout provides html/body; this layout adds no additional chrome.
 */
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
