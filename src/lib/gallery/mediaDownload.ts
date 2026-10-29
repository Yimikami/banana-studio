/** The server answered with an error status, so the response body is not the media file. */
export class DownloadHttpError extends Error {}

/** Read a media file for download. An HTTP error body is never saved as the file. */
export const fetchMediaBlob = async (url: string, fetcher: typeof fetch = fetch): Promise<Blob> => {
  const response = await fetcher(url);
  if (!response.ok) throw new DownloadHttpError(`Download failed (${response.status}). Reload the gallery and try again.`);
  return response.blob();
};

/** Opening the URL in a new tab helps only when the request itself failed.
 * After an HTTP error it would just show the server's error page. */
export const shouldOpenDownloadFallback = (error: unknown): boolean => !(error instanceof DownloadHttpError);
