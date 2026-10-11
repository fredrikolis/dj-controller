// Concern: where the twin reports what failed, each error passed whole | Non-concern: deciding what is an error | IO: (message, error) -> console
export const logger = {
  error(message: string, error: unknown): void {
    console.error(message, error)
  },
}
