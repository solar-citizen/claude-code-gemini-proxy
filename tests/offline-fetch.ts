/** Preload for credential-free tests. Only the synthetic loopback socket test uses real fetch. */
const localFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port)
    throw Error('offline test blocked external fetch');
  return localFetch(input, {...init, redirect:'error'});
}) as typeof fetch;
