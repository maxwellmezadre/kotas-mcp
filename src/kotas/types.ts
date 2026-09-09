// Raw payload shapes, as the Kotas API sends them. Deliberately loose: every
// field is optional and `unknown` where the type is not load-bearing, because
// the normalizers are the only place that decides what a field means. A new
// field appearing must never fail a sync.
//
// Nullable on purpose: this backend sends `null` rather than omitting a field,
// and several of them are null even when the value exists elsewhere in the
// payload (`grupoId` on a credit, whose id lives in the description).

export type RawInvoice = {
  id?: number | null;
  descricao?: string | null;
  statusId?: number | null;
  statusDescricao?: string | null;
  tipoId?: number | null;
  tipoDescricao?: string | null;
  vencida?: boolean | null;
  valor?: number | null;
  valor4Casas?: number | null;
  valorJuros?: number | null;
  valorJuros4Casas?: number | null;
  valorReajuste?: number | null;
  valorReajuste4Casas?: number | null;
  valorTotal?: number | null;
  valorTotal4Casas?: number | null;
  valorTaxa?: number | null;
  valorDesconto?: number | null;
  valorDesconto4Casas?: number | null;
  dataVencimento?: string | null;
  dataPagamento?: string | null;
  itens?: RawInvoiceItem[] | null;
  ehInscricaoEmGrupo?: boolean | null;
  idGatewayPagamento?: number | null;
  [field: string]: unknown;
};

export type RawInvoiceItem = {
  id?: number | null;
  quantidade?: number | null;
  descricao?: string | null;
  valor?: number | null;
  valor4Casas?: number | null;
  [field: string]: unknown;
};

export type RawGroupSummary = {
  id?: number | null;
  servicoId?: number | null;
  nome?: string | null;
  servico?: string | null;
  idCategoria?: number | null;
  adminNome?: string | null;
  valor?: number | null;
  dataCadastro?: string | null;
  fidelidade?: number | null;
  kotasTotais?: number | null;
  kotasAssinadas?: number | null;
  kotasDisponiveis?: number | null;
  inFilaEspera?: boolean | null;
  inAdministrador?: boolean | null;
  statusId?: number | null;
  status?: string | null;
  inCancelamentoAgendado?: boolean | null;
  privado?: boolean | null;
  [field: string]: unknown;
};

export type RawGroupDetail = RawGroupSummary & {
  descricao?: string | null;
  plano?: string | null;
  planoId?: number | null;
  categoriaDescricao?: string | null;
  valorTotalServico?: number | null;
  valorTotalServico4Casas?: number | null;
  valorSemTaxa?: number | null;
  valorTaxa?: number | null;
  temFidelidade?: boolean | null;
  dataTerminoFidelidade?: string | null;
  renovacaoAutomatica?: boolean | null;
  formaAcessoId?: number | null;
  dataCancelamento?: string | null;
  participantes?: RawParticipant[] | null;
  [field: string]: unknown;
};

export type RawParticipant = {
  id?: number | null;
  nome?: string | null;
  dataInscricao?: string | null;
  dataEnvioAcesso?: string | null;
  dataDescadastro?: string | null;
  inFilaEspera?: boolean | null;
  qtdKotas?: number | null;
  valor?: number | null;
  valor4Casas?: number | null;
  [field: string]: unknown;
};

export type RawCredit = {
  id?: number | null;
  descricao?: string | null;
  statusId?: number | null;
  statusDescricao?: string | null;
  tipoId?: number | null;
  valor?: number | null;
  valor4Casas?: number | null;
  taxa?: number | null;
  valorDisponivel?: number | null;
  valorDisponivel4Casas?: number | null;
  dataCredito?: string | null;
  faturaId?: number | null;
  grupoId?: number | null;
  disponivelParaEstorno?: boolean | null;
  [field: string]: unknown;
};

export type RawBalance = {
  valorDisponivel?: number | null;
  valorDisponivel4Casas?: number | null;
  valorBloqueado?: number | null;
  valorBloqueado4Casas?: number | null;
  valorPendente?: number | null;
  valorPendente4Casas?: number | null;
  [field: string]: unknown;
};

export type RawSavings = { valorEconomizado?: number | null; [field: string]: unknown };

export type RawPayout = {
  /** Equal to the group id. */
  id?: number | null;
  descricao?: string | null;
  vl_kota_membro?: number | null;
  valor?: number | null;
  valor4Casas?: number | null;
  statusId?: number | null;
  status?: string | null;
  dataProximoPagamento?: string | null;
  [field: string]: unknown;
};

export type RawPayoutEntry = {
  id?: number | null;
  descricao?: string | null;
  participante?: string | null;
  valor?: number | null;
  valor4Casas?: number | null;
  statusId?: number | null;
  statusDescricao?: string | null;
  data?: string | null;
  [field: string]: unknown;
};

export type RawService = {
  id?: number | null;
  nome?: string | null;
  nomeUrl?: string | null;
  descricao?: string | null;
  categoriaId?: number | null;
  nomeCategoria?: string | null;
  site?: string | null;
  valor?: number | null;
  qtdKotas?: number | null;
  status?: number | null;
  planos?: RawPlan[] | null;
  [field: string]: unknown;
};

export type RawPlan = {
  id?: number | null;
  idServico?: number | null;
  nome?: string | null;
  valor?: number | null;
  [field: string]: unknown;
};

/** The paginated envelope, used by `recebimento/obtergrupos` only. */
export type RawPage<T> = {
  indicePagina?: number | null;
  tamanhoPagina?: number | null;
  totalItens?: number | null;
  totalPaginas?: number | null;
  itens?: T[] | null;
  temProximaPagina?: boolean | null;
  [field: string]: unknown;
};
