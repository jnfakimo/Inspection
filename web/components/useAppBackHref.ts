'use client';

import { useEffect, useState } from 'react';
import { appVisitEntry, pushVisit, readVisitStack, resolveAppBackHref, resolveBackTarget, writeVisitStack } from '@/lib/app-navigation';

/**
 * 共用頁首「上頁」的連結：回到本分頁上一個站內頁面（上一個動作）；沒有上一個才依階層回父層。
 * 軌跡存在 sessionStorage（每個分頁各自一份），首次繪製與伺服器端一致，掛載後才換成軌跡目的地。
 */
export function useAppBackHref(pathname: string) {
  const [href, setHref] = useState(() => resolveAppBackHref(pathname));
  useEffect(() => {
    const search = window.location.search;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { storage = null; }
    const entry = appVisitEntry(pathname, search);
    if (!storage || !entry) { setHref(resolveAppBackHref(pathname)); return; }
    const stack = pushVisit(readVisitStack(storage), entry);
    writeVisitStack(storage, stack);
    setHref(resolveBackTarget(stack, pathname, search));
  }, [pathname]);
  return href;
}
