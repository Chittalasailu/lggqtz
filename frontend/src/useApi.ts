import { useEffect, useState } from "react";

interface State<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

/** Fetch JSON from `url`. Keeps the previous data while a new request is in flight,
 *  so charts don't flash empty when the user changes a control. */
export function useApi<T>(url: string | null): State<T> {
  const [state, setState] = useState<State<T>>({ loading: url !== null });

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.detail === "string" ? body.detail : `${res.status} ${res.statusText}`);
        }
        return res.json() as Promise<T>;
      })
      .then((data) => setState({ data, loading: false }))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setState((s) => ({ ...s, error: err.message, loading: false }));
      });
    return () => controller.abort();
  }, [url]);

  return state;
}
