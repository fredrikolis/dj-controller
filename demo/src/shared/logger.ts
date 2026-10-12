// Concern: where the page reports what failed, each error passed whole, and what it leaves undone | Non-concern: deciding what is an error | IO: (message, error) -> console
export const logger = {
  error(message: string, error: unknown): void {
    console.error(message, error)
  },
  note(message: string): void {
    console.info(message)
  },
}
