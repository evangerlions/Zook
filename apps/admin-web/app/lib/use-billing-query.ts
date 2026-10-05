import { useEffect, useRef, useState } from "react";

/** Local request generation prevents an older response replacing a newer app/filter selection. */
export function useBillingQuery<T>(load: () => Promise<T>, key: string) {
  const loader = useRef(load);
  loader.current = load;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let current = true;
    setState({ loading: true });
    void loader.current().then((data) => { if (current) setState({ data, loading: false }); },
      (error: unknown) => { if (current) setState({ error: error instanceof Error ? error.message : "请求失败", loading: false }); });
    return () => { current = false; };
  }, [key, revision]);
  return { ...state, refresh: () => setRevision((value) => value + 1) };
}
