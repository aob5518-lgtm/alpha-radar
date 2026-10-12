interface StreamCallbacks {
  message: (event: MessageEvent) => void;
  disconnected?: () => void;
  resumed?: () => void;
}

/** Reconnect boundedly after transport/lease-limit failures; disposal is final. */
export function connectChartStream(
  url: string,
  callbacks: StreamCallbacks,
  createSocket: (url: string) => WebSocket,
  timers: {
    schedule: (run: () => void, delay: number) => number;
    cancel: (id: number) => void;
  } = {
    schedule: (run, delay) => window.setTimeout(run, delay),
    cancel: (id) => window.clearTimeout(id),
  },
): () => void {
  let disposed = false;
  let socket: WebSocket | null = null;
  let timer: number | null = null;
  let attempts = 0;
  let opened = false;
  const connect = () => {
    if (disposed) return;
    const retryAttempt = attempts;
    const current = createSocket(url);
    socket = current;
    current.onopen = () => {
      if (disposed || socket !== current) return;
      if (opened || attempts > 0) callbacks.resumed?.();
      opened = true;
      attempts = 0;
    };
    current.onmessage = (event) => {
      if (!disposed && socket === current) callbacks.message(event);
    };
    current.onerror = () => {
      if (!disposed && socket === current) callbacks.disconnected?.();
    };
    current.onclose = (event) => {
      if (disposed || socket !== current) return;
      callbacks.disconnected?.();
      socket = null;
      if (event?.code === 1008) return;
      if (event?.code === 1013) attempts = Math.max(attempts, retryAttempt);
      const delay = Math.min(1000 * 2 ** attempts++, 10000);
      if (process.env.NODE_ENV === "development")
        console.info(
          JSON.stringify({
            event: "chart_stream_retry",
            code: event?.code ?? 0,
            delay_ms: delay,
          }),
        );
      timer = timers.schedule(connect, delay);
    };
  };
  connect();
  return () => {
    disposed = true;
    if (timer !== null) timers.cancel(timer);
    socket?.close();
  };
}
