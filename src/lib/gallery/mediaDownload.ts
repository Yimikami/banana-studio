/** The server answered with an error status or a non-media page. */
export class DownloadHttpError extends Error {}

/** Reject proxy/login/error pages even when they arrive with a 200 status. */
export const assertMediaDownloadResponse = (response: Response): void => {
  if (!response.ok) throw new DownloadHttpError(`Download failed (${response.status}). Reload the gallery and try again.`);
  const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (mime.startsWith('text/') || /^application\/(?:json|xml|[^/]+\+(?:json|xml))$/.test(mime)) {
    throw new DownloadHttpError('The download link returned a page instead of media. Reload the gallery and try again.');
  }
};

/** Read a media file for download. Error bodies are never saved as files. */
export const fetchMediaBlob = async (url: string, fetcher: typeof fetch = fetch): Promise<Blob> => {
  const response = await fetcher(url);
  assertMediaDownloadResponse(response);
  return response.blob();
};

/** Opening the URL in a new tab helps only when the request itself failed. */
export const shouldOpenDownloadFallback = (error: unknown): boolean => !(error instanceof DownloadHttpError);
