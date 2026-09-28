/** Forma do objeto `ArrServAt.values[i]` tal como vem no relatório SDM. Só os campos que usamos. */
export interface SdmRawRecord {
  id: number;
  id_prestador: number;
  id_gestora: number;
  cod_tipo_subtipo_prestacao: string;
  CDistMor?: string;
  CConcMor?: string;
  CFregMor?: string;
  CPost?: string;
  cod_prestador?: string;
  data: {
    cod_contrato: string;
    des_contrato?: string;
    fl_atual?: string;
    des_entid_gest: string;
    nif_entid_gest: string;
    des_entid_prest: string;
    ars_abrange_local_prestacao?: string;
    aces_abrange_local_prestacao?: string;
    cod_ambito?: string;
    natureza_juridica?: string;
    data_ini?: string;
    data_fim?: string;
    fl_convencao_suspensa?: string;
    descricao_convencao_suspensa?: string;
    tipo_prestacao?: string;
    sub_tipo_prestacao: string;
    des_sub_tipo_prestacao: string;
    valencias?: string;
    observacoes?: string;
  };
  contactos: Record<string, string | number | null | undefined>;
}

export interface SdmExtract {
  reportDate: string | null;
  records: SdmRawRecord[];
}
