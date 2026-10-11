// Concern: an error as the text the page shows, its causes after it | Non-concern: where it shows | IO: (thrown value) -> text
export const errorText = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err)
  return err.cause === undefined ? err.message : `${err.message}: ${errorText(err.cause)}`
}
