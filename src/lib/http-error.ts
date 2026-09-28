/** An error whose message is safe to show the user, returned by withApi() with this status. */
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
