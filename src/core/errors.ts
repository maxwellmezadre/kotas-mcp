// Error taxonomy for everything that talks to the Kotas API. Messages are
// user-facing (pt-BR) and actionable; the classes let callers (http, sync,
// tools, CLI) branch on the *kind* of failure without parsing text.

export const LOGIN_HINT =
  "Rode `kotas login` no terminal (e-mail e senha) ou `kotas login --from-browser chrome`.";

/** The API answered, but with a business error (`{message, statusCode, ...}`). */
export class KotasApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiMessage: string,
    public readonly path: string,
    hint?: string,
    /** The decoded error body, when it was JSON. A 412 carries the new device hash. */
    public readonly data?: unknown,
  ) {
    super(
      `O Kotas respondeu ${status} em ${path}: ${apiMessage || "sem mensagem"}` +
        (hint ? ` — ${hint}` : ""),
    );
    this.name = "KotasApiError";
  }
}

/** Transport-level failure: no session involved, just HTTP or the network. */
export class KotasHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "KotasHttpError";
  }
}

/** No session, or the Kotas rejected it. Fix: `kotas login`. */
export class KotasAuthError extends Error {
  constructor(message: string) {
    super(`${message} ${LOGIN_HINT}`);
    this.name = "KotasAuthError";
  }
}

/**
 * HTTP 412: the API wants the device or the IP released before it accepts the
 * login. The `hash` it returns becomes the new `hashDispositivo` and must be
 * persisted, or the next attempt starts the challenge over (spec §2.2).
 */
export class DeviceChallengeError extends Error {
  constructor(
    public readonly hash: string,
    public readonly tipoSolicitacao: number,
  ) {
    const what =
      tipoSolicitacao === 2 ? "o IP" : tipoSolicitacao === 1 ? "o dispositivo" : "o acesso";
    super(
      `O Kotas pediu a liberação d${what === "o IP" ? "o" : "o"} ${what}. ` +
        "Confirme pelo e-mail, SMS ou Telegram que a Kotas acabou de enviar e rode `kotas login` de novo. " +
        "O identificador do dispositivo foi salvo; não apague a sessão nem troque de máquina no meio do processo.",
    );
    this.name = "DeviceChallengeError";
  }
}

/** The account has 2FA on and the PIN is missing or wrong (spec §2.3). */
export class TwoFactorError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`kotas login --pin 123456\` com o código de 6 dígitos.`);
    this.name = "TwoFactorError";
  }
}

/** Repeated 429/5xx after the backoff budget. */
export class RateLimitError extends Error {
  constructor(
    public readonly attempts: number,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/** The session file or its key is unusable. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/** Interactive or browser-import login failed. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/** A payload no longer looks like what the normalizers expect. */
export class ParseError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`kotas doctor\` para ver qual camada quebrou.`);
    this.name = "ParseError";
  }
}

/**
 * Hints keyed by HTTP status. Open map on purpose: an unknown status simply
 * gets no hint instead of forcing an exhaustive switch to maintain.
 */
export const STATUS_HINTS: Record<number, string> = {
  400: "o Kotas devolve 400 também para grupo encerrado, que some da API depois do cancelamento",
  401: "token expirado ou recusado",
  404: "rota inexistente, ou faltou algum parâmetro obrigatório de query",
  412: "liberação de dispositivo ou de IP pendente",
  426: "a versão do front (header `versao`) está velha demais; ajuste KOTAS_APP_VERSION",
  429: "limite de requisições",
};
