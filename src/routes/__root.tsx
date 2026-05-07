import { createRootRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { KubeezWelcomePromo } from '@/components/marketing/kubeez-welcome-promo';
import { MobileNotAvailableScreen } from '@/components/shell/mobile-not-available-screen';
import { useMediaMinDesktop } from '@/hooks/use-media-min-width';

const DEFAULT_DOCUMENT_TITLE = 'KubeezCut — Free Open Source Browser Video Editor';
const HOME_DOCUMENT_TITLE = 'KubeezCut — Free Browser Video Editor with AI Generation via Kubeez.com';

function RootLayout() {
  const desktop = useMediaMinDesktop();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (pathname === '/') {
      document.title = HOME_DOCUMENT_TITLE;
    } else if (pathname === '/blog' || pathname.startsWith('/blog/')) {
      /* Blog routes set title + meta via useDocumentSeo */
    } else {
      document.title = DEFAULT_DOCUMENT_TITLE;
    }
  }, [pathname]);

  // Auth popup callback runs in a tiny popup window (~520px wide) that
  // would otherwise trip the mobile gate. Skip the entire shell for it —
  // the route closes itself in ~200ms.
  if (pathname === '/auth-popup-callback') {
    return <Outlet />;
  }

  if (!desktop) {
    return <MobileNotAvailableScreen />;
  }

  return (
    <>
      <KubeezWelcomePromo />
      <Outlet />
    </>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
