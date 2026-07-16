export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      accesos_residentes: {
        Row: {
          activo: boolean
          company_id: string
          created_at: string
          fecha_emision: string
          fecha_vencimiento: string | null
          id: string
          identificador: string
          notas: string | null
          project_id: string
          tipo: string
          titular: string
          unidad_id: string
        }
        Insert: {
          activo?: boolean
          company_id: string
          created_at?: string
          fecha_emision?: string
          fecha_vencimiento?: string | null
          id?: string
          identificador: string
          notas?: string | null
          project_id: string
          tipo?: string
          titular: string
          unidad_id: string
        }
        Update: {
          activo?: boolean
          company_id?: string
          created_at?: string
          fecha_emision?: string
          fecha_vencimiento?: string | null
          id?: string
          identificador?: string
          notas?: string | null
          project_id?: string
          tipo?: string
          titular?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accesos_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "accesos_residentes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accesos_residentes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      actas_reunion: {
        Row: {
          acuerdos: string | null
          aprobada: boolean
          asistentes: Json
          company_id: string
          created_at: string
          fecha: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          lugar: string | null
          observaciones: string | null
          orden_del_dia: Json
          project_id: string
          quorum: number | null
          quorum_requerido: number | null
          redactada_por: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          acuerdos?: string | null
          aprobada?: boolean
          asistentes?: Json
          company_id: string
          created_at?: string
          fecha: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          lugar?: string | null
          observaciones?: string | null
          orden_del_dia?: Json
          project_id: string
          quorum?: number | null
          quorum_requerido?: number | null
          redactada_por?: string | null
          tipo?: string
          titulo: string
        }
        Update: {
          acuerdos?: string | null
          aprobada?: boolean
          asistentes?: Json
          company_id?: string
          created_at?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          lugar?: string | null
          observaciones?: string | null
          orden_del_dia?: Json
          project_id?: string
          quorum?: number | null
          quorum_requerido?: number | null
          redactada_por?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "actas_reunion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actas_reunion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actas_reunion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "actas_reunion_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_operativa: {
        Row: {
          asignado_a: string | null
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          notas: string | null
          project_id: string
          recurrente: boolean
          tipo: string
          titulo: string
        }
        Insert: {
          asignado_a?: string | null
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          notas?: string | null
          project_id: string
          recurrente?: boolean
          tipo?: string
          titulo: string
        }
        Update: {
          asignado_a?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          notas?: string | null
          project_id?: string
          recurrente?: boolean
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_operativa_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_operativa_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_operativa_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "agenda_operativa_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      alertas_condominio: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_alerta: string
          id: string
          project_id: string
          referencia_id: string | null
          referencia_tabla: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_alerta: string
          id?: string
          project_id: string
          referencia_id?: string | null
          referencia_tabla?: string | null
          tipo?: string
          titulo: string
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_alerta?: string
          id?: string
          project_id?: string
          referencia_id?: string | null
          referencia_tabla?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alertas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "alertas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      amenidades: {
        Row: {
          activo: boolean
          capacidad_max: number | null
          company_id: string
          created_at: string
          descripcion: string | null
          duracion_max_horas: number | null
          foto_url: string | null
          horario_fin: string | null
          horario_inicio: string | null
          horas_minimas_antelacion: number | null
          id: string
          max_reservas_mes_unidad: number | null
          minutos_preparacion_posterior: number
          minutos_preparacion_previa: number
          monto_deposito: number | null
          nombre: string
          project_id: string
          reglamento: string | null
          requiere_aprobacion: boolean
          requiere_deposito: boolean
          requiere_tarifa: boolean
          tarifa_uso: number | null
          tarifa_uso_finde: number | null
        }
        Insert: {
          activo?: boolean
          capacidad_max?: number | null
          company_id: string
          created_at?: string
          descripcion?: string | null
          duracion_max_horas?: number | null
          foto_url?: string | null
          horario_fin?: string | null
          horario_inicio?: string | null
          horas_minimas_antelacion?: number | null
          id?: string
          max_reservas_mes_unidad?: number | null
          minutos_preparacion_posterior?: number
          minutos_preparacion_previa?: number
          monto_deposito?: number | null
          nombre: string
          project_id: string
          reglamento?: string | null
          requiere_aprobacion?: boolean
          requiere_deposito?: boolean
          requiere_tarifa?: boolean
          tarifa_uso?: number | null
          tarifa_uso_finde?: number | null
        }
        Update: {
          activo?: boolean
          capacidad_max?: number | null
          company_id?: string
          created_at?: string
          descripcion?: string | null
          duracion_max_horas?: number | null
          foto_url?: string | null
          horario_fin?: string | null
          horario_inicio?: string | null
          horas_minimas_antelacion?: number | null
          id?: string
          max_reservas_mes_unidad?: number | null
          minutos_preparacion_posterior?: number
          minutos_preparacion_previa?: number
          monto_deposito?: number | null
          nombre?: string
          project_id?: string
          reglamento?: string | null
          requiere_aprobacion?: boolean
          requiere_deposito?: boolean
          requiere_tarifa?: boolean
          tarifa_uso?: number | null
          tarifa_uso_finde?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "amenidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "amenidades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      amenidades_bloqueos: {
        Row: {
          amenidad_id: string
          company_id: string
          created_at: string
          fecha_fin: string
          fecha_inicio: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          motivo: string | null
          project_id: string
        }
        Insert: {
          amenidad_id: string
          company_id: string
          created_at?: string
          fecha_fin: string
          fecha_inicio: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          motivo?: string | null
          project_id: string
        }
        Update: {
          amenidad_id?: string
          company_id?: string
          created_at?: string
          fecha_fin?: string
          fecha_inicio?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          motivo?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "amenidades_bloqueos_amenidad_id_fkey"
            columns: ["amenidad_id"]
            isOneToOne: false
            referencedRelation: "amenidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "amenidades_bloqueos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      anuncios_comunidad: {
        Row: {
          activo: boolean
          company_id: string
          contenido: string
          created_at: string
          fecha_evento: string | null
          foto_url: string | null
          id: string
          project_id: string
          publicado_por: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          activo?: boolean
          company_id: string
          contenido: string
          created_at?: string
          fecha_evento?: string | null
          foto_url?: string | null
          id?: string
          project_id: string
          publicado_por?: string | null
          tipo?: string
          titulo: string
        }
        Update: {
          activo?: boolean
          company_id?: string
          contenido?: string
          created_at?: string
          fecha_evento?: string | null
          foto_url?: string | null
          id?: string
          project_id?: string
          publicado_por?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_comunidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anuncios_comunidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anuncios_comunidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "anuncios_comunidad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anuncios_comunidad_publicado_por_app_users_fkey"
            columns: ["publicado_por"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          activo: boolean
          cliente_id: string | null
          company_id: string | null
          created_at: string | null
          full_name: string | null
          id: string
          permission_type: string | null
          project_id: string | null
          role: string
        }
        Insert: {
          activo?: boolean
          cliente_id?: string | null
          company_id?: string | null
          created_at?: string | null
          full_name?: string | null
          id: string
          permission_type?: string | null
          project_id?: string | null
          role: string
        }
        Update: {
          activo?: boolean
          cliente_id?: string | null
          company_id?: string | null
          created_at?: string | null
          full_name?: string | null
          id?: string
          permission_type?: string | null
          project_id?: string | null
          role?: string
        }
        Relationships: []
      }
      areas_condominio: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string | null
          icono: string | null
          id: string
          nombre: string
          orden: number | null
          project_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          nombre: string
          orden?: number | null
          project_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          nombre?: string
          orden?: number | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      asambleas: {
        Row: {
          acta: string | null
          company_id: string
          convocado_por: string | null
          created_at: string
          estado: string
          fecha: string
          hora_fin: string | null
          hora_inicio: string
          id: string
          lugar: string | null
          project_id: string
          quorum_alcanzado: number | null
          quorum_requerido: number
          tipo: string
          titulo: string
        }
        Insert: {
          acta?: string | null
          company_id: string
          convocado_por?: string | null
          created_at?: string
          estado?: string
          fecha: string
          hora_fin?: string | null
          hora_inicio: string
          id?: string
          lugar?: string | null
          project_id: string
          quorum_alcanzado?: number | null
          quorum_requerido?: number
          tipo?: string
          titulo: string
        }
        Update: {
          acta?: string | null
          company_id?: string
          convocado_por?: string | null
          created_at?: string
          estado?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string
          id?: string
          lugar?: string | null
          project_id?: string
          quorum_alcanzado?: number | null
          quorum_requerido?: number
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "asambleas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asambleas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asambleas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "asambleas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      asambleas_digital: {
        Row: {
          acta_url: string | null
          company_id: string
          created_at: string | null
          created_by: string | null
          descripcion: string | null
          estado: string
          fecha_hora: string
          id: string
          link_reunion: string | null
          modalidad: string
          project_id: string
          quorum_requerido: number
          titulo: string
        }
        Insert: {
          acta_url?: string | null
          company_id: string
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_hora: string
          id?: string
          link_reunion?: string | null
          modalidad?: string
          project_id: string
          quorum_requerido?: number
          titulo: string
        }
        Update: {
          acta_url?: string | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_hora?: string
          id?: string
          link_reunion?: string | null
          modalidad?: string
          project_id?: string
          quorum_requerido?: number
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "asambleas_digital_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asambleas_digital_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asambleas_digital_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "asambleas_digital_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asambleas_digital_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          company_id: string | null
          id: number
          occurred_at: string
          project_id: string | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          id?: number
          occurred_at?: string
          project_id?: string | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          id?: number
          occurred_at?: string
          project_id?: string | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      automatizaciones_cond: {
        Row: {
          accion_config: Json
          accion_tipo: string
          activa: boolean
          company_id: string
          created_at: string
          id: string
          nombre: string
          notas: string | null
          project_id: string
          trigger_tipo: string
          trigger_valor: number
          ultima_ejecucion: string | null
        }
        Insert: {
          accion_config?: Json
          accion_tipo?: string
          activa?: boolean
          company_id: string
          created_at?: string
          id?: string
          nombre: string
          notas?: string | null
          project_id: string
          trigger_tipo?: string
          trigger_valor?: number
          ultima_ejecucion?: string | null
        }
        Update: {
          accion_config?: Json
          accion_tipo?: string
          activa?: boolean
          company_id?: string
          created_at?: string
          id?: string
          nombre?: string
          notas?: string | null
          project_id?: string
          trigger_tipo?: string
          trigger_valor?: number
          ultima_ejecucion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automatizaciones_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automatizaciones_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automatizaciones_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "automatizaciones_cond_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      avisos_cobro: {
        Row: {
          company_id: string
          created_at: string
          detalle: Json
          enviado_por: string | null
          estado: string
          fecha_emision: string
          fecha_limite: string | null
          id: string
          monto_total: number
          notas: string | null
          project_id: string
          tipo: string
          unidad_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          detalle?: Json
          enviado_por?: string | null
          estado?: string
          fecha_emision?: string
          fecha_limite?: string | null
          id?: string
          monto_total: number
          notas?: string | null
          project_id: string
          tipo?: string
          unidad_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          detalle?: Json
          enviado_por?: string | null
          estado?: string
          fecha_emision?: string
          fecha_limite?: string | null
          id?: string
          monto_total?: number
          notas?: string | null
          project_id?: string
          tipo?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avisos_cobro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_cobro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_cobro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "avisos_cobro_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_cobro_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      banco_movimientos: {
        Row: {
          company_id: string
          conciliado_at: string | null
          conciliado_por: string | null
          created_at: string
          cuenta_bancaria_id: string
          descripcion: string | null
          estado: string
          fecha: string
          id: string
          lote_id: string | null
          match_id: string | null
          match_tipo: string | null
          monto: number
          referencia: string | null
        }
        Insert: {
          company_id: string
          conciliado_at?: string | null
          conciliado_por?: string | null
          created_at?: string
          cuenta_bancaria_id: string
          descripcion?: string | null
          estado?: string
          fecha: string
          id?: string
          lote_id?: string | null
          match_id?: string | null
          match_tipo?: string | null
          monto: number
          referencia?: string | null
        }
        Update: {
          company_id?: string
          conciliado_at?: string | null
          conciliado_por?: string | null
          created_at?: string
          cuenta_bancaria_id?: string
          descripcion?: string | null
          estado?: string
          fecha?: string
          id?: string
          lote_id?: string | null
          match_id?: string | null
          match_tipo?: string | null
          monto?: number
          referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banco_movimientos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_movimientos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "banco_movimientos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "banco_movimientos_cuenta_bancaria_id_fkey"
            columns: ["cuenta_bancaria_id"]
            isOneToOne: false
            referencedRelation: "cuentas_bancarias"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          base_activation_cents: number
          code: string
          created_at: string
          currency: string
          description: string | null
          extra_project_cents: number
          feature_codes: Json
          features: Json
          id: string
          includes_agua: boolean
          includes_condominios: boolean
          is_active: boolean
          max_projects: number | null
          max_units: number | null
          name: string
          price_monthly_cents: number
          price_yearly_cents: number | null
          sort_order: number
          stripe_price_id_activation: string | null
          stripe_price_id_extra_project: string | null
          stripe_price_id_monthly: string | null
          stripe_price_id_unit_extra: string | null
          stripe_price_id_unit_primary: string | null
          stripe_price_id_yearly: string | null
          unit_extra_cents: number
          unit_primary_cents: number
          updated_at: string
        }
        Insert: {
          base_activation_cents?: number
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          extra_project_cents?: number
          feature_codes?: Json
          features?: Json
          id?: string
          includes_agua?: boolean
          includes_condominios?: boolean
          is_active?: boolean
          max_projects?: number | null
          max_units?: number | null
          name: string
          price_monthly_cents?: number
          price_yearly_cents?: number | null
          sort_order?: number
          stripe_price_id_activation?: string | null
          stripe_price_id_extra_project?: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_unit_extra?: string | null
          stripe_price_id_unit_primary?: string | null
          stripe_price_id_yearly?: string | null
          unit_extra_cents?: number
          unit_primary_cents?: number
          updated_at?: string
        }
        Update: {
          base_activation_cents?: number
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          extra_project_cents?: number
          feature_codes?: Json
          features?: Json
          id?: string
          includes_agua?: boolean
          includes_condominios?: boolean
          is_active?: boolean
          max_projects?: number | null
          max_units?: number | null
          name?: string
          price_monthly_cents?: number
          price_yearly_cents?: number | null
          sort_order?: number
          stripe_price_id_activation?: string | null
          stripe_price_id_extra_project?: string | null
          stripe_price_id_monthly?: string | null
          stripe_price_id_unit_extra?: string | null
          stripe_price_id_unit_primary?: string | null
          stripe_price_id_yearly?: string | null
          unit_extra_cents?: number
          unit_primary_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      billing_sync_log: {
        Row: {
          changes: Json | null
          company_id: string | null
          id: number
          last_error: string | null
          outcome: string
          ran_at: string
          stripe_subscription_id: string | null
          subscription_id: string | null
        }
        Insert: {
          changes?: Json | null
          company_id?: string | null
          id?: number
          last_error?: string | null
          outcome: string
          ran_at?: string
          stripe_subscription_id?: string | null
          subscription_id?: string | null
        }
        Update: {
          changes?: Json | null
          company_id?: string | null
          id?: number
          last_error?: string | null
          outcome?: string
          ran_at?: string
          stripe_subscription_id?: string | null
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "billing_sync_log_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_acciones: {
        Row: {
          accion: string
          company_id: string
          created_at: string
          detalles: Json | null
          entidad_desc: string | null
          entidad_id: string | null
          id: string
          ip_address: string | null
          modulo: string
          project_id: string | null
          usuario_id: string | null
          usuario_nombre: string
        }
        Insert: {
          accion: string
          company_id: string
          created_at?: string
          detalles?: Json | null
          entidad_desc?: string | null
          entidad_id?: string | null
          id?: string
          ip_address?: string | null
          modulo: string
          project_id?: string | null
          usuario_id?: string | null
          usuario_nombre: string
        }
        Update: {
          accion?: string
          company_id?: string
          created_at?: string
          detalles?: Json | null
          entidad_desc?: string | null
          entidad_id?: string | null
          id?: string
          ip_address?: string | null
          modulo?: string
          project_id?: string | null
          usuario_id?: string | null
          usuario_nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_acciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_acciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_acciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "bitacora_acciones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_acciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_guardia: {
        Row: {
          company_id: string
          created_at: string
          estado: string
          fecha: string
          guardia_nombre: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          novedades: Json
          observaciones: string | null
          project_id: string
          turno: string
        }
        Insert: {
          company_id: string
          created_at?: string
          estado?: string
          fecha?: string
          guardia_nombre: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          novedades?: Json
          observaciones?: string | null
          project_id: string
          turno?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          estado?: string
          fecha?: string
          guardia_nombre?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          novedades?: Json
          observaciones?: string | null
          project_id?: string
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_guardia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_guardia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_guardia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "bitacora_guardia_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_manto: {
        Row: {
          area: string | null
          company_id: string
          created_at: string
          fecha: string
          firmado: boolean
          id: string
          observaciones: string | null
          project_id: string
          responsable: string
          tareas: Json
          turno: string
        }
        Insert: {
          area?: string | null
          company_id: string
          created_at?: string
          fecha?: string
          firmado?: boolean
          id?: string
          observaciones?: string | null
          project_id: string
          responsable: string
          tareas?: Json
          turno?: string
        }
        Update: {
          area?: string | null
          company_id?: string
          created_at?: string
          fecha?: string
          firmado?: boolean
          id?: string
          observaciones?: string | null
          project_id?: string
          responsable?: string
          tareas?: Json
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_manto_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_manto_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_manto_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "bitacora_manto_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      bloques_turno: {
        Row: {
          company_id: string
          creado_por: string | null
          created_at: string
          estado: string
          fecha: string
          finalizado_en: string | null
          id: string
          iniciado_en: string | null
          notas: string | null
          personal_id: string
          project_id: string
          turno: string
        }
        Insert: {
          company_id: string
          creado_por?: string | null
          created_at?: string
          estado?: string
          fecha: string
          finalizado_en?: string | null
          id?: string
          iniciado_en?: string | null
          notas?: string | null
          personal_id: string
          project_id: string
          turno: string
        }
        Update: {
          company_id?: string
          creado_por?: string | null
          created_at?: string
          estado?: string
          fecha?: string
          finalizado_en?: string | null
          id?: string
          iniciado_en?: string | null
          notas?: string | null
          personal_id?: string
          project_id?: string
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloques_turno_personal_id_fkey"
            columns: ["personal_id"]
            isOneToOne: false
            referencedRelation: "personal_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bloques_turno_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      bodegas_condominio: {
        Row: {
          area_m2: number | null
          company_id: string
          created_at: string
          estado: string
          fecha_asignacion: string | null
          id: string
          monto_renta: number | null
          notas: string | null
          numero: string
          piso: string | null
          project_id: string
          unidad_id: string | null
        }
        Insert: {
          area_m2?: number | null
          company_id: string
          created_at?: string
          estado?: string
          fecha_asignacion?: string | null
          id?: string
          monto_renta?: number | null
          notas?: string | null
          numero: string
          piso?: string | null
          project_id: string
          unidad_id?: string | null
        }
        Update: {
          area_m2?: number | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha_asignacion?: string | null
          id?: string
          monto_renta?: number | null
          notas?: string | null
          numero?: string
          piso?: string | null
          project_id?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bodegas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodegas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodegas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "bodegas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bodegas_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          cliente_id: string
          company_id: string | null
          created_at: string | null
          email_error: string | null
          email_sent: boolean | null
          id: string
          read_at: string | null
        }
        Insert: {
          broadcast_id: string
          cliente_id: string
          company_id?: string | null
          created_at?: string | null
          email_error?: string | null
          email_sent?: boolean | null
          id?: string
          read_at?: string | null
        }
        Update: {
          broadcast_id?: string
          cliente_id?: string
          company_id?: string | null
          created_at?: string | null
          email_error?: string | null
          email_sent?: boolean | null
          id?: string
          read_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          body: string
          company_id: string
          created_at: string | null
          id: string
          recipient_count: number
          send_email: boolean
          sent_by_id: string
          sent_by_name: string
          target_ids: string[]
          target_type: string
          title: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string | null
          id?: string
          recipient_count?: number
          send_email?: boolean
          sent_by_id: string
          sent_by_name: string
          target_ids?: string[]
          target_type: string
          title: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string | null
          id?: string
          recipient_count?: number
          send_email?: boolean
          sent_by_id?: string
          sent_by_name?: string
          target_ids?: string[]
          target_type?: string
          title?: string
        }
        Relationships: []
      }
      caja_chica: {
        Row: {
          cerrado_por: string | null
          company_id: string
          created_at: string
          estado: string
          fecha_apertura: string
          fecha_cierre: string | null
          id: string
          monto_inicial: number
          notas: string | null
          project_id: string
          responsable: string
        }
        Insert: {
          cerrado_por?: string | null
          company_id: string
          created_at?: string
          estado?: string
          fecha_apertura?: string
          fecha_cierre?: string | null
          id?: string
          monto_inicial?: number
          notas?: string | null
          project_id: string
          responsable: string
        }
        Update: {
          cerrado_por?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha_apertura?: string
          fecha_cierre?: string | null
          id?: string
          monto_inicial?: number
          notas?: string | null
          project_id?: string
          responsable?: string
        }
        Relationships: [
          {
            foreignKeyName: "caja_chica_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_chica_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_chica_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "caja_chica_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      calidad_tipologias: {
        Row: {
          activo: boolean
          company_id: string | null
          created_at: string
          id: string
          label: string
          parametros: Json
          tipo_agua: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          company_id?: string | null
          created_at?: string
          id?: string
          label: string
          parametros: Json
          tipo_agua: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          company_id?: string | null
          created_at?: string
          id?: string
          label?: string
          parametros?: Json
          tipo_agua?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calidad_tipologias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calidad_tipologias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calidad_tipologias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      campanas_cobro: {
        Row: {
          canal: string
          company_id: string
          created_at: string
          criterio_dias_mora: number | null
          criterio_monto_min: number | null
          enviada_por: string | null
          enviadas: number
          estado: string
          fallidas: number
          fecha_envio: string | null
          id: string
          mensaje: string
          nombre: string
          project_id: string
          total_destinatarios: number
        }
        Insert: {
          canal?: string
          company_id: string
          created_at?: string
          criterio_dias_mora?: number | null
          criterio_monto_min?: number | null
          enviada_por?: string | null
          enviadas?: number
          estado?: string
          fallidas?: number
          fecha_envio?: string | null
          id?: string
          mensaje: string
          nombre: string
          project_id: string
          total_destinatarios?: number
        }
        Update: {
          canal?: string
          company_id?: string
          created_at?: string
          criterio_dias_mora?: number | null
          criterio_monto_min?: number | null
          enviada_por?: string | null
          enviadas?: number
          estado?: string
          fallidas?: number
          fecha_envio?: string | null
          id?: string
          mensaje?: string
          nombre?: string
          project_id?: string
          total_destinatarios?: number
        }
        Relationships: [
          {
            foreignKeyName: "campanas_cobro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanas_cobro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanas_cobro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "campanas_cobro_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      capacitacion_personal_cond: {
        Row: {
          cargo: string | null
          company_id: string
          costo: number | null
          created_at: string
          curso: string
          estado: string
          fecha_fin: string | null
          fecha_inicio: string
          fecha_vencimiento_cert: string | null
          id: string
          nombre_empleado: string
          notas: string | null
          personal_id: string | null
          project_id: string
          proveedor: string | null
        }
        Insert: {
          cargo?: string | null
          company_id: string
          costo?: number | null
          created_at?: string
          curso: string
          estado?: string
          fecha_fin?: string | null
          fecha_inicio: string
          fecha_vencimiento_cert?: string | null
          id?: string
          nombre_empleado: string
          notas?: string | null
          personal_id?: string | null
          project_id: string
          proveedor?: string | null
        }
        Update: {
          cargo?: string | null
          company_id?: string
          costo?: number | null
          created_at?: string
          curso?: string
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          fecha_vencimiento_cert?: string | null
          id?: string
          nombre_empleado?: string
          notas?: string | null
          personal_id?: string | null
          project_id?: string
          proveedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capacitacion_personal_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacitacion_personal_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacitacion_personal_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "capacitacion_personal_cond_personal_id_fkey"
            columns: ["personal_id"]
            isOneToOne: false
            referencedRelation: "personal_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacitacion_personal_cond_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cargos_adicionales_unidad: {
        Row: {
          categoria: string
          company_id: string
          concepto: string
          created_at: string
          estado: string
          fecha_cargo: string
          fecha_vencimiento: string | null
          id: string
          monto: number
          observaciones: string | null
          project_id: string
          referencia: string | null
          unidad_id: string
        }
        Insert: {
          categoria?: string
          company_id: string
          concepto: string
          created_at?: string
          estado?: string
          fecha_cargo?: string
          fecha_vencimiento?: string | null
          id?: string
          monto: number
          observaciones?: string | null
          project_id: string
          referencia?: string | null
          unidad_id: string
        }
        Update: {
          categoria?: string
          company_id?: string
          concepto?: string
          created_at?: string
          estado?: string
          fecha_cargo?: string
          fecha_vencimiento?: string | null
          id?: string
          monto?: number
          observaciones?: string | null
          project_id?: string
          referencia?: string | null
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cargos_adicionales_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cargos_adicionales_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cargos_adicionales_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cargos_adicionales_unidad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cargos_adicionales_unidad_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_areas: {
        Row: {
          area: string
          company_id: string
          created_at: string
          estado: string
          fecha: string
          id: string
          inspector: string | null
          items: Json
          notas: string | null
          project_id: string
        }
        Insert: {
          area: string
          company_id: string
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          inspector?: string | null
          items?: Json
          notas?: string | null
          project_id: string
        }
        Update: {
          area?: string
          company_id?: string
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          inspector?: string | null
          items?: Json
          notas?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "checklist_areas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cierres_anuales: {
        Row: {
          anio: number
          company_id: string
          created_at: string
          estado: string
          fecha_cierre: string | null
          firmado_por: string | null
          id: string
          monto_mora_total: number
          notas: string | null
          project_id: string
          saldo: number
          tasa_recaudacion: number | null
          total_cuotas_cobradas: number
          total_cuotas_generadas: number
          total_egresos: number
          total_ingresos: number
          unidades_morosas: number
        }
        Insert: {
          anio: number
          company_id: string
          created_at?: string
          estado?: string
          fecha_cierre?: string | null
          firmado_por?: string | null
          id?: string
          monto_mora_total?: number
          notas?: string | null
          project_id: string
          saldo?: number
          tasa_recaudacion?: number | null
          total_cuotas_cobradas?: number
          total_cuotas_generadas?: number
          total_egresos?: number
          total_ingresos?: number
          unidades_morosas?: number
        }
        Update: {
          anio?: number
          company_id?: string
          created_at?: string
          estado?: string
          fecha_cierre?: string | null
          firmado_por?: string | null
          id?: string
          monto_mora_total?: number
          notas?: string | null
          project_id?: string
          saldo?: number
          tasa_recaudacion?: number | null
          total_cuotas_cobradas?: number
          total_cuotas_generadas?: number
          total_egresos?: number
          total_ingresos?: number
          unidades_morosas?: number
        }
        Relationships: [
          {
            foreignKeyName: "cierres_anuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cierres_anuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cierres_anuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cierres_anuales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cierres_mensuales: {
        Row: {
          cerrado_por: string | null
          company_id: string
          created_at: string
          estado: string
          id: string
          notas: string | null
          periodo: string
          project_id: string
          saldo_periodo: number
          total_cuotas_cobradas: number
          total_cuotas_emitidas: number
          total_gastos: number
          unidades_morosas: number
        }
        Insert: {
          cerrado_por?: string | null
          company_id: string
          created_at?: string
          estado?: string
          id?: string
          notas?: string | null
          periodo: string
          project_id: string
          saldo_periodo?: number
          total_cuotas_cobradas?: number
          total_cuotas_emitidas?: number
          total_gastos?: number
          unidades_morosas?: number
        }
        Update: {
          cerrado_por?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          id?: string
          notas?: string | null
          periodo?: string
          project_id?: string
          saldo_periodo?: number
          total_cuotas_cobradas?: number
          total_cuotas_emitidas?: number
          total_gastos?: number
          unidades_morosas?: number
        }
        Relationships: [
          {
            foreignKeyName: "cierres_mensuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cierres_mensuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cierres_mensuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cierres_mensuales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          codigo: string
          created_at: string | null
          cui_dui: string | null
          direccion: string | null
          email: string | null
          fecha_nacimiento: string | null
          id: string
          lectura_inicial: number | null
          medidor: string | null
          nacionalidad: string | null
          nit: string | null
          nombre: string
          nombre_fiscal: string | null
          numero_facturacion: string | null
          project_id: string | null
          puede_crear_cuenta: boolean
          rfc: string | null
          telefono: string | null
          telefono_alterno: string | null
          updated_at: string | null
          updated_by: string | null
          updated_by_name: string | null
          uso_cfdi: string | null
          whatsapp: string | null
        }
        Insert: {
          codigo: string
          created_at?: string | null
          cui_dui?: string | null
          direccion?: string | null
          email?: string | null
          fecha_nacimiento?: string | null
          id?: string
          lectura_inicial?: number | null
          medidor?: string | null
          nacionalidad?: string | null
          nit?: string | null
          nombre: string
          nombre_fiscal?: string | null
          numero_facturacion?: string | null
          project_id?: string | null
          puede_crear_cuenta?: boolean
          rfc?: string | null
          telefono?: string | null
          telefono_alterno?: string | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
          uso_cfdi?: string | null
          whatsapp?: string | null
        }
        Update: {
          codigo?: string
          created_at?: string | null
          cui_dui?: string | null
          direccion?: string | null
          email?: string | null
          fecha_nacimiento?: string | null
          id?: string
          lectura_inicial?: number | null
          medidor?: string | null
          nacionalidad?: string | null
          nit?: string | null
          nombre?: string
          nombre_fiscal?: string | null
          numero_facturacion?: string | null
          project_id?: string | null
          puede_crear_cuenta?: boolean
          rfc?: string | null
          telefono?: string | null
          telefono_alterno?: string | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
          uso_cfdi?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cobranza_judicial: {
        Row: {
          abogado: string | null
          company_id: string
          created_at: string
          estado: string
          etapa: string
          expediente: string | null
          fecha_actualizacion: string | null
          fecha_inicio: string
          id: string
          monto_adeudado: number
          notas: string | null
          project_id: string
          unidad_id: string
        }
        Insert: {
          abogado?: string | null
          company_id: string
          created_at?: string
          estado?: string
          etapa?: string
          expediente?: string | null
          fecha_actualizacion?: string | null
          fecha_inicio?: string
          id?: string
          monto_adeudado?: number
          notas?: string | null
          project_id: string
          unidad_id: string
        }
        Update: {
          abogado?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          etapa?: string
          expediente?: string | null
          fecha_actualizacion?: string | null
          fecha_inicio?: string
          id?: string
          monto_adeudado?: number
          notas?: string | null
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cobranza_judicial_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranza_judicial_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranza_judicial_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cobranza_judicial_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobranza_judicial_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      comentarios_ticket: {
        Row: {
          autor_id: string | null
          autor_nombre: string
          company_id: string
          contenido: string
          created_at: string
          estado_nuevo: string | null
          id: string
          ticket_id: string
        }
        Insert: {
          autor_id?: string | null
          autor_nombre: string
          company_id: string
          contenido: string
          created_at?: string
          estado_nuevo?: string | null
          id?: string
          ticket_id: string
        }
        Update: {
          autor_id?: string | null
          autor_nombre?: string
          company_id?: string
          contenido?: string
          created_at?: string
          estado_nuevo?: string | null
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comentarios_ticket_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_ticket_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_ticket_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_ticket_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "comentarios_ticket_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets_mantenimiento"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          activa: boolean
          address_city: string | null
          address_line1: string | null
          address_postal_code: string | null
          address_state: string | null
          ambiente_pago: string
          center_lat: number | null
          center_lng: number | null
          country: string | null
          created_at: string | null
          default_currency: string
          email: string | null
          id: string
          iva_tasa_default: number
          logo_url: string | null
          max_projects: number
          max_units: number
          mfa_required: boolean
          nit: string | null
          nombre: string
          nombre_fiscal: string | null
          pago_sandbox_demo: boolean
          paypal_activo: boolean | null
          paypal_client_id: string | null
          paypal_configured: boolean | null
          paypal_currency_code: string | null
          proveedor_pago: string
          proveedor_timbrado: string
          regimen_fiscal: string
          rfc: string | null
          servicio_agua: boolean
          servicio_condominios: boolean
          signup_source: string
          stripe_activo: boolean | null
          stripe_configured: boolean | null
          stripe_public_key: string | null
          suspended_at: string | null
          suspended_reason: string | null
          tax_id: string | null
          tax_id_type: string | null
          telefono: string | null
          zoom_default: number | null
        }
        Insert: {
          activa?: boolean
          address_city?: string | null
          address_line1?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          ambiente_pago?: string
          center_lat?: number | null
          center_lng?: number | null
          country?: string | null
          created_at?: string | null
          default_currency?: string
          email?: string | null
          id?: string
          iva_tasa_default?: number
          logo_url?: string | null
          max_projects?: number
          max_units?: number
          mfa_required?: boolean
          nit?: string | null
          nombre: string
          nombre_fiscal?: string | null
          pago_sandbox_demo?: boolean
          paypal_activo?: boolean | null
          paypal_client_id?: string | null
          paypal_configured?: boolean | null
          paypal_currency_code?: string | null
          proveedor_pago?: string
          proveedor_timbrado?: string
          regimen_fiscal?: string
          rfc?: string | null
          servicio_agua?: boolean
          servicio_condominios?: boolean
          signup_source?: string
          stripe_activo?: boolean | null
          stripe_configured?: boolean | null
          stripe_public_key?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          tax_id?: string | null
          tax_id_type?: string | null
          telefono?: string | null
          zoom_default?: number | null
        }
        Update: {
          activa?: boolean
          address_city?: string | null
          address_line1?: string | null
          address_postal_code?: string | null
          address_state?: string | null
          ambiente_pago?: string
          center_lat?: number | null
          center_lng?: number | null
          country?: string | null
          created_at?: string | null
          default_currency?: string
          email?: string | null
          id?: string
          iva_tasa_default?: number
          logo_url?: string | null
          max_projects?: number
          max_units?: number
          mfa_required?: boolean
          nit?: string | null
          nombre?: string
          nombre_fiscal?: string | null
          pago_sandbox_demo?: boolean
          paypal_activo?: boolean | null
          paypal_client_id?: string | null
          paypal_configured?: boolean | null
          paypal_currency_code?: string | null
          proveedor_pago?: string
          proveedor_timbrado?: string
          regimen_fiscal?: string
          rfc?: string | null
          servicio_agua?: boolean
          servicio_condominios?: boolean
          signup_source?: string
          stripe_activo?: boolean | null
          stripe_configured?: boolean | null
          stripe_public_key?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          tax_id?: string | null
          tax_id_type?: string | null
          telefono?: string | null
          zoom_default?: number | null
        }
        Relationships: []
      }
      company_branding: {
        Row: {
          accent_color: string | null
          company_id: string
          created_at: string
          primary_color: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          company_id: string
          created_at?: string
          primary_color?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          company_id?: string
          created_at?: string
          primary_color?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_branding_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_branding_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_branding_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_clientes: {
        Row: {
          activo: boolean
          added_by: string | null
          cliente_id: string
          company_id: string
          created_at: string | null
          id: string
        }
        Insert: {
          activo?: boolean
          added_by?: string | null
          cliente_id: string
          company_id: string
          created_at?: string | null
          id?: string
        }
        Update: {
          activo?: boolean
          added_by?: string | null
          cliente_id?: string
          company_id?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_clientes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_clientes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_clientes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_clientes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_email_configs: {
        Row: {
          access_token: string | null
          company_id: string | null
          created_at: string
          email: string | null
          from_name: string | null
          id: string
          is_active: boolean
          is_superadmin: boolean
          provider: string
          refresh_token: string | null
          reply_to: string | null
          token_expiry: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          from_name?: string | null
          id?: string
          is_active?: boolean
          is_superadmin?: boolean
          provider?: string
          refresh_token?: string | null
          reply_to?: string | null
          token_expiry?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          from_name?: string | null
          id?: string
          is_active?: boolean
          is_superadmin?: boolean
          provider?: string
          refresh_token?: string | null
          reply_to?: string | null
          token_expiry?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_email_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_email_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_email_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_payment_secrets: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          paypal_client_secret: string | null
          stripe_secret_key: string | null
          stripe_webhook_secret: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          paypal_client_secret?: string | null
          stripe_secret_key?: string | null
          stripe_webhook_secret?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          paypal_client_secret?: string | null
          stripe_secret_key?: string | null
          stripe_webhook_secret?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_payment_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_payment_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_payment_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_sso_domains: {
        Row: {
          company_id: string
          created_at: string
          domain: string
          enforced: boolean
          id: string
          idp_metadata: Json
          sso_provider_id: string | null
          updated_at: string
          verification_token: string
          verified: boolean
        }
        Insert: {
          company_id: string
          created_at?: string
          domain: string
          enforced?: boolean
          id?: string
          idp_metadata?: Json
          sso_provider_id?: string | null
          updated_at?: string
          verification_token?: string
          verified?: boolean
        }
        Update: {
          company_id?: string
          created_at?: string
          domain?: string
          enforced?: boolean
          id?: string
          idp_metadata?: Json
          sso_provider_id?: string | null
          updated_at?: string
          verification_token?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_sso_domains_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_sso_domains_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_sso_domains_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      comunicados_condominio: {
        Row: {
          company_id: string
          contenido: string
          created_at: string
          destinatario: string
          enviado_por: string | null
          fecha_envio: string
          firmado: boolean
          id: string
          project_id: string
          tipo: string
          titulo: string
          unidad_id: string | null
        }
        Insert: {
          company_id: string
          contenido: string
          created_at?: string
          destinatario?: string
          enviado_por?: string | null
          fecha_envio?: string
          firmado?: boolean
          id?: string
          project_id: string
          tipo?: string
          titulo: string
          unidad_id?: string | null
        }
        Update: {
          company_id?: string
          contenido?: string
          created_at?: string
          destinatario?: string
          enviado_por?: string | null
          fecha_envio?: string
          firmado?: boolean
          id?: string
          project_id?: string
          tipo?: string
          titulo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comunicados_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "comunicados_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicados_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      conciliacion_cobros_log: {
        Row: {
          company_id: string
          created_at: string
          cuota_id: string
          diferencia: number
          estado: string
          fecha_pago: string
          id: string
          metodo_pago: string
          monto_cuota: number
          monto_recibido: number
          notas: string | null
          project_id: string
          referencia_pago: string | null
          unidad_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          cuota_id: string
          diferencia?: number
          estado?: string
          fecha_pago?: string
          id?: string
          metodo_pago?: string
          monto_cuota: number
          monto_recibido: number
          notas?: string | null
          project_id: string
          referencia_pago?: string | null
          unidad_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          cuota_id?: string
          diferencia?: number
          estado?: string
          fecha_pago?: string
          id?: string
          metodo_pago?: string
          monto_cuota?: number
          monto_recibido?: number
          notas?: string | null
          project_id?: string
          referencia_pago?: string | null
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conciliacion_cobros_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacion_cobros_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacion_cobros_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conciliacion_cobros_log_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacion_cobros_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conciliacion_cobros_log_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      config_condominio: {
        Row: {
          company_id: string
          created_at: string
          cuota_base: number | null
          dias_gracia: number
          email_admin: string | null
          id: string
          max_reservas_por_unidad_mes: number
          metodos_pago: string[]
          nombre_administrador: string | null
          notif_dias_antes_vencimiento: number
          permitir_reservas_online: boolean
          project_id: string
          reglamento_url: string | null
          tasa_mora_mensual: number
          telefono_admin: string | null
          terminos_mudanza: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          cuota_base?: number | null
          dias_gracia?: number
          email_admin?: string | null
          id?: string
          max_reservas_por_unidad_mes?: number
          metodos_pago?: string[]
          nombre_administrador?: string | null
          notif_dias_antes_vencimiento?: number
          permitir_reservas_online?: boolean
          project_id: string
          reglamento_url?: string | null
          tasa_mora_mensual?: number
          telefono_admin?: string | null
          terminos_mudanza?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          cuota_base?: number | null
          dias_gracia?: number
          email_admin?: string | null
          id?: string
          max_reservas_por_unidad_mes?: number
          metodos_pago?: string[]
          nombre_administrador?: string | null
          notif_dias_antes_vencimiento?: number
          permitir_reservas_online?: boolean
          project_id?: string
          reglamento_url?: string | null
          tasa_mora_mensual?: number
          telefono_admin?: string | null
          terminos_mudanza?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "config_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion_condominio: {
        Row: {
          clave: string
          company_id: string
          descripcion: string | null
          id: string
          project_id: string
          tipo: string
          updated_at: string
          valor: string | null
        }
        Insert: {
          clave: string
          company_id: string
          descripcion?: string | null
          id?: string
          project_id: string
          tipo?: string
          updated_at?: string
          valor?: string | null
        }
        Update: {
          clave?: string
          company_id?: string
          descripcion?: string | null
          id?: string
          project_id?: string
          tipo?: string
          updated_at?: string
          valor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuracion_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuracion_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "configuracion_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      consumo_energia_areas: {
        Row: {
          area: string
          company_id: string
          costo_unitario: number | null
          created_at: string
          fecha_lectura: string
          id: string
          lectura_actual: number
          lectura_anterior: number | null
          notas: string | null
          periodo: string
          project_id: string
          tipo: string
          total_costo: number | null
          unidad: string
        }
        Insert: {
          area: string
          company_id: string
          costo_unitario?: number | null
          created_at?: string
          fecha_lectura?: string
          id?: string
          lectura_actual: number
          lectura_anterior?: number | null
          notas?: string | null
          periodo: string
          project_id: string
          tipo?: string
          total_costo?: number | null
          unidad?: string
        }
        Update: {
          area?: string
          company_id?: string
          costo_unitario?: number | null
          created_at?: string
          fecha_lectura?: string
          id?: string
          lectura_actual?: number
          lectura_anterior?: number | null
          notas?: string | null
          periodo?: string
          project_id?: string
          tipo?: string
          total_costo?: number | null
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "consumo_energia_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumo_energia_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumo_energia_areas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "consumo_energia_areas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_asiento_lineas: {
        Row: {
          asiento_id: string
          company_id: string
          cuenta_id: string
          debe: number
          descripcion: string | null
          haber: number
          id: string
          moneda_origen: string | null
          monto_origen: number | null
          orden: number
          tipo_cambio: number | null
        }
        Insert: {
          asiento_id: string
          company_id: string
          cuenta_id: string
          debe?: number
          descripcion?: string | null
          haber?: number
          id?: string
          moneda_origen?: string | null
          monto_origen?: number | null
          orden?: number
          tipo_cambio?: number | null
        }
        Update: {
          asiento_id?: string
          company_id?: string
          cuenta_id?: string
          debe?: number
          descripcion?: string | null
          haber?: number
          id?: string
          moneda_origen?: string | null
          monto_origen?: number | null
          orden?: number
          tipo_cambio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conta_asiento_lineas_asiento_id_fkey"
            columns: ["asiento_id"]
            isOneToOne: false
            referencedRelation: "conta_asientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asiento_lineas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asiento_lineas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asiento_lineas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conta_asiento_lineas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "conta_cuentas"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_asientos: {
        Row: {
          anulado_por_id: string | null
          company_id: string
          concepto: string
          created_at: string
          created_by: string | null
          estado: string
          fecha: string
          id: string
          moneda_base: string
          numero: number | null
          origen: string
          origen_evento: string | null
          origen_id: string | null
          origen_tabla: string | null
          periodo: string | null
          project_id: string | null
          publicado_at: string | null
          reversa_de_id: string | null
          tipo: string
          total_debe: number
          total_haber: number
          updated_at: string
        }
        Insert: {
          anulado_por_id?: string | null
          company_id: string
          concepto: string
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha?: string
          id?: string
          moneda_base?: string
          numero?: number | null
          origen?: string
          origen_evento?: string | null
          origen_id?: string | null
          origen_tabla?: string | null
          periodo?: string | null
          project_id?: string | null
          publicado_at?: string | null
          reversa_de_id?: string | null
          tipo?: string
          total_debe?: number
          total_haber?: number
          updated_at?: string
        }
        Update: {
          anulado_por_id?: string | null
          company_id?: string
          concepto?: string
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha?: string
          id?: string
          moneda_base?: string
          numero?: number | null
          origen?: string
          origen_evento?: string | null
          origen_id?: string | null
          origen_tabla?: string | null
          periodo?: string | null
          project_id?: string | null
          publicado_at?: string | null
          reversa_de_id?: string | null
          tipo?: string
          total_debe?: number
          total_haber?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conta_asientos_anulado_por_id_fkey"
            columns: ["anulado_por_id"]
            isOneToOne: false
            referencedRelation: "conta_asientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asientos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asientos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asientos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conta_asientos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_asientos_reversa_de_id_fkey"
            columns: ["reversa_de_id"]
            isOneToOne: false
            referencedRelation: "conta_asientos"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_cierres_anuales: {
        Row: {
          anio: number
          asiento_id: string
          cerrado_por: string | null
          company_id: string
          created_at: string
          id: string
          project_id: string | null
        }
        Insert: {
          anio: number
          asiento_id: string
          cerrado_por?: string | null
          company_id: string
          created_at?: string
          id?: string
          project_id?: string | null
        }
        Update: {
          anio?: number
          asiento_id?: string
          cerrado_por?: string | null
          company_id?: string
          created_at?: string
          id?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conta_cierres_anuales_asiento_id_fkey"
            columns: ["asiento_id"]
            isOneToOne: false
            referencedRelation: "conta_asientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_cierres_anuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_cierres_anuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_cierres_anuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conta_cierres_anuales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_cuentas: {
        Row: {
          activa: boolean
          codigo: string
          company_id: string
          created_at: string
          descripcion: string | null
          es_detalle: boolean
          es_sistema: boolean
          id: string
          moneda: string | null
          naturaleza: string
          nivel: number
          nombre: string
          padre_id: string | null
          project_id: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          codigo: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          es_detalle?: boolean
          es_sistema?: boolean
          id?: string
          moneda?: string | null
          naturaleza: string
          nivel?: number
          nombre: string
          padre_id?: string | null
          project_id?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          codigo?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          es_detalle?: boolean
          es_sistema?: boolean
          id?: string
          moneda?: string | null
          naturaleza?: string
          nivel?: number
          nombre?: string
          padre_id?: string | null
          project_id?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conta_cuentas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_cuentas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_cuentas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conta_cuentas_padre_id_fkey"
            columns: ["padre_id"]
            isOneToOne: false
            referencedRelation: "conta_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_cuentas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_folios: {
        Row: {
          company_id: string
          id: string
          project_id: string | null
          ultimo: number
        }
        Insert: {
          company_id: string
          id?: string
          project_id?: string | null
          ultimo?: number
        }
        Update: {
          company_id?: string
          id?: string
          project_id?: string | null
          ultimo?: number
        }
        Relationships: [
          {
            foreignKeyName: "conta_folios_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_folios_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_folios_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conta_folios_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_mapeo_cuentas: {
        Row: {
          company_id: string
          created_at: string
          cuenta_id: string
          evento: string
          id: string
          project_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          cuenta_id: string
          evento: string
          id?: string
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          cuenta_id?: string
          evento?: string
          id?: string
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conta_mapeo_cuentas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_mapeo_cuentas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_mapeo_cuentas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "conta_mapeo_cuentas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "conta_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_mapeo_cuentas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conta_tipos_cambio: {
        Row: {
          company_id: string
          created_at: string
          fecha: string
          id: string
          moneda: string
          tasa: number
        }
        Insert: {
          company_id: string
          created_at?: string
          fecha?: string
          id?: string
          moneda: string
          tasa: number
        }
        Update: {
          company_id?: string
          created_at?: string
          fecha?: string
          id?: string
          moneda?: string
          tasa?: number
        }
        Relationships: [
          {
            foreignKeyName: "conta_tipos_cambio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_tipos_cambio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conta_tipos_cambio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      contactos_emergencia: {
        Row: {
          activo: boolean
          company_id: string
          created_at: string
          descripcion: string | null
          disponible_24h: boolean
          id: string
          nombre: string
          orden: number
          project_id: string
          telefono: string
          telefono_alternativo: string | null
          tipo: string
        }
        Insert: {
          activo?: boolean
          company_id: string
          created_at?: string
          descripcion?: string | null
          disponible_24h?: boolean
          id?: string
          nombre: string
          orden?: number
          project_id: string
          telefono: string
          telefono_alternativo?: string | null
          tipo?: string
        }
        Update: {
          activo?: boolean
          company_id?: string
          created_at?: string
          descripcion?: string | null
          disponible_24h?: boolean
          id?: string
          nombre?: string
          orden?: number
          project_id?: string
          telefono?: string
          telefono_alternativo?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "contactos_emergencia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contactos_emergencia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contactos_emergencia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "contactos_emergencia_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      contadores: {
        Row: {
          activo: boolean
          cantidad_derecho_servicio_m3: number | null
          company_id: string
          contratista_instalador: string | null
          created_at: string | null
          descripcion: string | null
          fecha_instalacion: string | null
          fecha_reemplazo_sugerida: string | null
          garantia_instalacion_vence: string | null
          id: string
          lectura_inicial: number
          llave_antifraude: string | null
          marca: string | null
          material: string | null
          medida: string | null
          modelo: string | null
          numero_derecho_servicio: string | null
          numero_serie: string
          periodicidad_lectura_dias: number | null
          project_id: string
          tarifa_id: string | null
          tipo_agua: string
          tipo_contador: string | null
          tipo_llave: string | null
          unidad_id: string | null
          updated_at: string | null
          updated_by: string | null
          updated_by_name: string | null
          valvula_aire: string | null
          valvula_cheque: string | null
        }
        Insert: {
          activo?: boolean
          cantidad_derecho_servicio_m3?: number | null
          company_id: string
          contratista_instalador?: string | null
          created_at?: string | null
          descripcion?: string | null
          fecha_instalacion?: string | null
          fecha_reemplazo_sugerida?: string | null
          garantia_instalacion_vence?: string | null
          id?: string
          lectura_inicial?: number
          llave_antifraude?: string | null
          marca?: string | null
          material?: string | null
          medida?: string | null
          modelo?: string | null
          numero_derecho_servicio?: string | null
          numero_serie: string
          periodicidad_lectura_dias?: number | null
          project_id: string
          tarifa_id?: string | null
          tipo_agua: string
          tipo_contador?: string | null
          tipo_llave?: string | null
          unidad_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
          valvula_aire?: string | null
          valvula_cheque?: string | null
        }
        Update: {
          activo?: boolean
          cantidad_derecho_servicio_m3?: number | null
          company_id?: string
          contratista_instalador?: string | null
          created_at?: string | null
          descripcion?: string | null
          fecha_instalacion?: string | null
          fecha_reemplazo_sugerida?: string | null
          garantia_instalacion_vence?: string | null
          id?: string
          lectura_inicial?: number
          llave_antifraude?: string | null
          marca?: string | null
          material?: string | null
          medida?: string | null
          modelo?: string | null
          numero_derecho_servicio?: string | null
          numero_serie?: string
          periodicidad_lectura_dias?: number | null
          project_id?: string
          tarifa_id?: string | null
          tipo_agua?: string
          tipo_contador?: string | null
          tipo_llave?: string | null
          unidad_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
          valvula_aire?: string | null
          valvula_cheque?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contadores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contadores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contadores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "contadores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contadores_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "tarifas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contadores_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos_arrendamiento: {
        Row: {
          arrendatario_email: string | null
          arrendatario_identificacion: string | null
          arrendatario_nombre: string
          arrendatario_telefono: string | null
          company_id: string
          created_at: string
          deposito: number | null
          dia_pago: number
          estado: string
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          monto_renta: number
          notas: string | null
          project_id: string
          unidad_id: string
        }
        Insert: {
          arrendatario_email?: string | null
          arrendatario_identificacion?: string | null
          arrendatario_nombre: string
          arrendatario_telefono?: string | null
          company_id: string
          created_at?: string
          deposito?: number | null
          dia_pago?: number
          estado?: string
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          monto_renta: number
          notas?: string | null
          project_id: string
          unidad_id: string
        }
        Update: {
          arrendatario_email?: string | null
          arrendatario_identificacion?: string | null
          arrendatario_nombre?: string
          arrendatario_telefono?: string | null
          company_id?: string
          created_at?: string
          deposito?: number | null
          dia_pago?: number
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          monto_renta?: number
          notas?: string | null
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contratos_arrendamiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_arrendamiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_arrendamiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "contratos_arrendamiento_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_arrendamiento_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos_proveedores: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string | null
          documento_url: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          monto_mensual: number | null
          notas: string | null
          project_id: string
          proveedor_contacto: string | null
          proveedor_email: string | null
          proveedor_nombre: string
          proveedor_telefono: string | null
          servicio: string
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion?: string | null
          documento_url?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          monto_mensual?: number | null
          notas?: string | null
          project_id: string
          proveedor_contacto?: string | null
          proveedor_email?: string | null
          proveedor_nombre: string
          proveedor_telefono?: string | null
          servicio?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string | null
          documento_url?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          monto_mensual?: number | null
          notas?: string | null
          project_id?: string
          proveedor_contacto?: string | null
          proveedor_email?: string | null
          proveedor_nombre?: string
          proveedor_telefono?: string | null
          servicio?: string
        }
        Relationships: [
          {
            foreignKeyName: "contratos_proveedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_proveedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_proveedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "contratos_proveedores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      control_camaras_seguridad: {
        Row: {
          activo: boolean
          codigo: string
          company_id: string
          created_at: string
          dias_retencion: number | null
          estado: string
          grabacion: boolean
          id: string
          ip_address: string | null
          nombre: string
          observaciones: string | null
          project_id: string
          proximo_mantenimiento: string | null
          resolucion: string | null
          tipo: string
          ubicacion: string
          ultimo_mantenimiento: string | null
        }
        Insert: {
          activo?: boolean
          codigo: string
          company_id: string
          created_at?: string
          dias_retencion?: number | null
          estado?: string
          grabacion?: boolean
          id?: string
          ip_address?: string | null
          nombre: string
          observaciones?: string | null
          project_id: string
          proximo_mantenimiento?: string | null
          resolucion?: string | null
          tipo?: string
          ubicacion: string
          ultimo_mantenimiento?: string | null
        }
        Update: {
          activo?: boolean
          codigo?: string
          company_id?: string
          created_at?: string
          dias_retencion?: number | null
          estado?: string
          grabacion?: boolean
          id?: string
          ip_address?: string | null
          nombre?: string
          observaciones?: string | null
          project_id?: string
          proximo_mantenimiento?: string | null
          resolucion?: string | null
          tipo?: string
          ubicacion?: string
          ultimo_mantenimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "control_camaras_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_camaras_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_camaras_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "control_camaras_seguridad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      control_generador: {
        Row: {
          company_id: string
          costo: number | null
          created_at: string
          empresa_servicio: string | null
          estado: string
          fecha: string
          frecuencia: number | null
          generador: string
          horas_acumuladas: number | null
          horas_operacion: number | null
          id: string
          nivel_combustible_pct: number | null
          observaciones: string | null
          operador: string | null
          project_id: string
          proximo_mantenimiento: string | null
          tipo: string
          voltaje: number | null
        }
        Insert: {
          company_id: string
          costo?: number | null
          created_at?: string
          empresa_servicio?: string | null
          estado?: string
          fecha?: string
          frecuencia?: number | null
          generador?: string
          horas_acumuladas?: number | null
          horas_operacion?: number | null
          id?: string
          nivel_combustible_pct?: number | null
          observaciones?: string | null
          operador?: string | null
          project_id: string
          proximo_mantenimiento?: string | null
          tipo?: string
          voltaje?: number | null
        }
        Update: {
          company_id?: string
          costo?: number | null
          created_at?: string
          empresa_servicio?: string | null
          estado?: string
          fecha?: string
          frecuencia?: number | null
          generador?: string
          horas_acumuladas?: number | null
          horas_operacion?: number | null
          id?: string
          nivel_combustible_pct?: number | null
          observaciones?: string | null
          operador?: string | null
          project_id?: string
          proximo_mantenimiento?: string | null
          tipo?: string
          voltaje?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "control_generador_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_generador_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_generador_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "control_generador_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      control_piscina: {
        Row: {
          cloro: number | null
          company_id: string
          created_at: string
          estado: string
          fecha: string
          hora: string | null
          id: string
          num_usuarios: number | null
          observaciones: string | null
          ph: number | null
          piscina: string
          project_id: string
          registrado_por: string | null
          temperatura: number | null
          turbiedad: string
        }
        Insert: {
          cloro?: number | null
          company_id: string
          created_at?: string
          estado?: string
          fecha?: string
          hora?: string | null
          id?: string
          num_usuarios?: number | null
          observaciones?: string | null
          ph?: number | null
          piscina?: string
          project_id: string
          registrado_por?: string | null
          temperatura?: number | null
          turbiedad?: string
        }
        Update: {
          cloro?: number | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha?: string
          hora?: string | null
          id?: string
          num_usuarios?: number | null
          observaciones?: string | null
          ph?: number | null
          piscina?: string
          project_id?: string
          registrado_por?: string | null
          temperatura?: number | null
          turbiedad?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_piscina_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_piscina_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_piscina_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "control_piscina_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      control_plagas: {
        Row: {
          areas: string[]
          company_id: string
          costo: number | null
          created_at: string
          empresa: string | null
          fecha: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          observaciones: string | null
          productos: string | null
          project_id: string
          proxima_visita: string | null
          resultado: string
          tecnico: string | null
          tipo: string
        }
        Insert: {
          areas?: string[]
          company_id: string
          costo?: number | null
          created_at?: string
          empresa?: string | null
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          observaciones?: string | null
          productos?: string | null
          project_id: string
          proxima_visita?: string | null
          resultado?: string
          tecnico?: string | null
          tipo?: string
        }
        Update: {
          areas?: string[]
          company_id?: string
          costo?: number | null
          created_at?: string
          empresa?: string | null
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          observaciones?: string | null
          productos?: string | null
          project_id?: string
          proxima_visita?: string | null
          resultado?: string
          tecnico?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_plagas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_plagas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_plagas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "control_plagas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      control_sistema_incendio: {
        Row: {
          company_id: string
          costo: number | null
          created_at: string
          empresa_servicio: string | null
          fecha: string
          fecha_vencimiento: string | null
          id: string
          identificador: string
          observaciones: string | null
          project_id: string
          proxima_inspeccion: string | null
          resultado: string
          tecnico: string | null
          tipo_inspeccion: string
          tipo_sistema: string
          ubicacion: string
        }
        Insert: {
          company_id: string
          costo?: number | null
          created_at?: string
          empresa_servicio?: string | null
          fecha?: string
          fecha_vencimiento?: string | null
          id?: string
          identificador: string
          observaciones?: string | null
          project_id: string
          proxima_inspeccion?: string | null
          resultado?: string
          tecnico?: string | null
          tipo_inspeccion?: string
          tipo_sistema?: string
          ubicacion: string
        }
        Update: {
          company_id?: string
          costo?: number | null
          created_at?: string
          empresa_servicio?: string | null
          fecha?: string
          fecha_vencimiento?: string | null
          id?: string
          identificador?: string
          observaciones?: string | null
          project_id?: string
          proxima_inspeccion?: string | null
          resultado?: string
          tecnico?: string | null
          tipo_inspeccion?: string
          tipo_sistema?: string
          ubicacion?: string
        }
        Relationships: [
          {
            foreignKeyName: "control_sistema_incendio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_sistema_incendio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "control_sistema_incendio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "control_sistema_incendio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      convenios_cuota_cond: {
        Row: {
          aprobado_por: string | null
          company_id: string
          created_at: string
          cuotas_pagadas: number
          descripcion: string
          dia_pago: number
          estado: string
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          monto_cuota: number
          monto_total: number
          notas: string | null
          num_cuotas: number
          project_id: string
          unidad_id: string
        }
        Insert: {
          aprobado_por?: string | null
          company_id: string
          created_at?: string
          cuotas_pagadas?: number
          descripcion: string
          dia_pago?: number
          estado?: string
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          monto_cuota: number
          monto_total: number
          notas?: string | null
          num_cuotas?: number
          project_id: string
          unidad_id: string
        }
        Update: {
          aprobado_por?: string | null
          company_id?: string
          created_at?: string
          cuotas_pagadas?: number
          descripcion?: string
          dia_pago?: number
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          monto_cuota?: number
          monto_total?: number
          notas?: string | null
          num_cuotas?: number
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "convenios_cuota_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convenios_cuota_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convenios_cuota_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "convenios_cuota_cond_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convenios_cuota_cond_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      convenios_pago: {
        Row: {
          cliente_id: string
          company_id: string | null
          created_at: string | null
          created_by: string | null
          cuotas: Json | null
          cuotas_pactadas: number | null
          descripcion: string | null
          estado: string
          fecha_inicio: string
          fecha_vencimiento: string | null
          id: string
          monto_pagado: number
          monto_total: number
          notas: string | null
          numero_convenio: string
          project_id: string | null
          registro_ids: Json | null
          updated_at: string | null
        }
        Insert: {
          cliente_id: string
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cuotas?: Json | null
          cuotas_pactadas?: number | null
          descripcion?: string | null
          estado?: string
          fecha_inicio?: string
          fecha_vencimiento?: string | null
          id?: string
          monto_pagado?: number
          monto_total: number
          notas?: string | null
          numero_convenio: string
          project_id?: string | null
          registro_ids?: Json | null
          updated_at?: string | null
        }
        Update: {
          cliente_id?: string
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cuotas?: Json | null
          cuotas_pactadas?: number | null
          descripcion?: string | null
          estado?: string
          fecha_inicio?: string
          fecha_vencimiento?: string | null
          id?: string
          monto_pagado?: number
          monto_total?: number
          notas?: string | null
          numero_convenio?: string
          project_id?: string | null
          registro_ids?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "convenios_pago_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convenios_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convenios_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "convenios_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "convenios_pago_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_access_rules: {
        Row: {
          can_assign: boolean
          can_respond: boolean
          can_view_all: boolean
          categories: string[] | null
          company_id: string
          created_at: string
          id: string
          role: string
          service_type: string
          updated_at: string
        }
        Insert: {
          can_assign?: boolean
          can_respond?: boolean
          can_view_all?: boolean
          categories?: string[] | null
          company_id: string
          created_at?: string
          id?: string
          role: string
          service_type?: string
          updated_at?: string
        }
        Update: {
          can_assign?: boolean
          can_respond?: boolean
          can_view_all?: boolean
          categories?: string[] | null
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          service_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_assignments: {
        Row: {
          assigned_by_id: string
          assigned_by_name: string
          conversation_id: string
          created_at: string
          id: string
          seen_at: string | null
          user_id: string
          user_name: string
        }
        Insert: {
          assigned_by_id: string
          assigned_by_name: string
          conversation_id: string
          created_at?: string
          id?: string
          seen_at?: string | null
          user_id: string
          user_name: string
        }
        Update: {
          assigned_by_id?: string
          assigned_by_name?: string
          conversation_id?: string
          created_at?: string
          id?: string
          seen_at?: string | null
          user_id?: string
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          body: string
          conversation_id: string
          created_at: string
          id: string
          is_internal_note: boolean
          read_at: string | null
          sender_id: string
          sender_name: string | null
          sender_type: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string
          conversation_id: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          read_at?: string | null
          sender_id: string
          sender_name?: string | null
          sender_type: string
        }
        Update: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          read_at?: string | null
          sender_id?: string
          sender_name?: string | null
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_name: string | null
          assigned_to: string | null
          category: string
          cliente_id: string | null
          cliente_nombre: string | null
          closed_at: string | null
          company_id: string
          created_at: string
          id: string
          is_internal: boolean
          priority: string
          project_id: string | null
          service_type: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_name?: string | null
          assigned_to?: string | null
          category?: string
          cliente_id?: string | null
          cliente_nombre?: string | null
          closed_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_internal?: boolean
          priority?: string
          project_id?: string | null
          service_type?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_name?: string | null
          assigned_to?: string | null
          category?: string
          cliente_id?: string | null
          cliente_nombre?: string | null
          closed_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          priority?: string
          project_id?: string | null
          service_type?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      correspondencia_condominio: {
        Row: {
          asunto: string
          categoria: string
          company_id: string
          created_at: string
          destinatario: string | null
          estado: string
          fecha: string
          id: string
          numero_guia: string | null
          observaciones: string | null
          prioridad: string
          project_id: string
          remitente: string | null
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          asunto: string
          categoria?: string
          company_id: string
          created_at?: string
          destinatario?: string | null
          estado?: string
          fecha?: string
          id?: string
          numero_guia?: string | null
          observaciones?: string | null
          prioridad?: string
          project_id: string
          remitente?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          asunto?: string
          categoria?: string
          company_id?: string
          created_at?: string
          destinatario?: string | null
          estado?: string
          fecha?: string
          id?: string
          numero_guia?: string | null
          observaciones?: string | null
          prioridad?: string
          project_id?: string
          remitente?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "correspondencia_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondencia_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondencia_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "correspondencia_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondencia_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas_bancarias: {
        Row: {
          activa: boolean
          banco: string
          company_id: string
          created_at: string
          cuenta_contable_id: string
          id: string
          moneda: string | null
          nombre: string
          notas: string | null
          numero_mascara: string | null
          project_id: string | null
          updated_at: string
        }
        Insert: {
          activa?: boolean
          banco: string
          company_id: string
          created_at?: string
          cuenta_contable_id: string
          id?: string
          moneda?: string | null
          nombre: string
          notas?: string | null
          numero_mascara?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          activa?: boolean
          banco?: string
          company_id?: string
          created_at?: string
          cuenta_contable_id?: string
          id?: string
          moneda?: string | null
          nombre?: string
          notas?: string | null
          numero_mascara?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_bancarias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_bancarias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_bancarias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cuentas_bancarias_cuenta_contable_id_fkey"
            columns: ["cuenta_contable_id"]
            isOneToOne: true
            referencedRelation: "conta_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_bancarias_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cuota_recordatorios_log: {
        Row: {
          company_id: string | null
          created_at: string
          cuota_id: string
          hito: string
          id: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          cuota_id: string
          hito: string
          id?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          cuota_id?: string
          hito?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuota_recordatorios_log_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
        ]
      }
      cuotas_condominio: {
        Row: {
          anulada_at: string | null
          company_id: string
          comprobante_url: string | null
          concepto: string
          created_at: string
          created_by: string | null
          cuota_estado: string | null
          deleted_at: string | null
          deleted_by: string | null
          emitida_at: string | null
          estado: string
          fecha_pago: string | null
          fecha_vencimiento: string | null
          id: string
          metodo_pago: string | null
          monto: number
          mora_aplicada_at: string | null
          mora_monto: number | null
          notas: string | null
          pagada_at: string | null
          pago_id: string | null
          periodo: string
          project_id: string
          referencia_pago: string | null
          regla_mora_id: string | null
          rol_responsable: string | null
          rubros_detalle: Json | null
          total_a_pagar: number | null
          unidad_id: string | null
          vencida_at: string | null
        }
        Insert: {
          anulada_at?: string | null
          company_id: string
          comprobante_url?: string | null
          concepto?: string
          created_at?: string
          created_by?: string | null
          cuota_estado?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          emitida_at?: string | null
          estado?: string
          fecha_pago?: string | null
          fecha_vencimiento?: string | null
          id?: string
          metodo_pago?: string | null
          monto: number
          mora_aplicada_at?: string | null
          mora_monto?: number | null
          notas?: string | null
          pagada_at?: string | null
          pago_id?: string | null
          periodo: string
          project_id: string
          referencia_pago?: string | null
          regla_mora_id?: string | null
          rol_responsable?: string | null
          rubros_detalle?: Json | null
          total_a_pagar?: number | null
          unidad_id?: string | null
          vencida_at?: string | null
        }
        Update: {
          anulada_at?: string | null
          company_id?: string
          comprobante_url?: string | null
          concepto?: string
          created_at?: string
          created_by?: string | null
          cuota_estado?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          emitida_at?: string | null
          estado?: string
          fecha_pago?: string | null
          fecha_vencimiento?: string | null
          id?: string
          metodo_pago?: string | null
          monto?: number
          mora_aplicada_at?: string | null
          mora_monto?: number | null
          notas?: string | null
          pagada_at?: string | null
          pago_id?: string | null
          periodo?: string
          project_id?: string
          referencia_pago?: string | null
          regla_mora_id?: string | null
          rol_responsable?: string | null
          rubros_detalle?: Json | null
          total_a_pagar?: number | null
          unidad_id?: string | null
          vencida_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cuotas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cuotas_condominio_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "pagos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_condominio_regla_mora_id_fkey"
            columns: ["regla_mora_id"]
            isOneToOne: false
            referencedRelation: "reglas_mora_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      cuotas_plan_pago: {
        Row: {
          company_id: string
          comprobante: string | null
          created_at: string
          fecha_pago: string | null
          fecha_vencimiento: string
          id: string
          monto: number
          numero: number
          pagado: boolean
          plan_id: string
        }
        Insert: {
          company_id: string
          comprobante?: string | null
          created_at?: string
          fecha_pago?: string | null
          fecha_vencimiento: string
          id?: string
          monto: number
          numero: number
          pagado?: boolean
          plan_id: string
        }
        Update: {
          company_id?: string
          comprobante?: string | null
          created_at?: string
          fecha_pago?: string | null
          fecha_vencimiento?: string
          id?: string
          monto?: number
          numero?: number
          pagado?: boolean
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuotas_plan_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_plan_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuotas_plan_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "cuotas_plan_pago_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes_pago_condominio"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_condominio: {
        Row: {
          categoria: string
          company_id: string
          created_at: string
          descripcion: string | null
          id: string
          project_id: string
          subido_por: string | null
          titulo: string
          url: string
          version: string | null
          vigente: boolean
          visibilidad: string
        }
        Insert: {
          categoria?: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          id?: string
          project_id: string
          subido_por?: string | null
          titulo: string
          url: string
          version?: string | null
          vigente?: boolean
          visibilidad?: string
        }
        Update: {
          categoria?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          project_id?: string
          subido_por?: string | null
          titulo?: string
          url?: string
          version?: string | null
          vigente?: boolean
          visibilidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "documentos_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_fiscales: {
        Row: {
          company_id: string
          created_at: string
          error: string | null
          estado: string
          fecha_certificacion: string | null
          id: string
          numero: string | null
          numero_autorizacion: string | null
          proveedor: string | null
          regimen: string
          registro_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          serie: string | null
          tipo: string
          updated_at: string
          uuid_fiscal: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          error?: string | null
          estado?: string
          fecha_certificacion?: string | null
          id?: string
          numero?: string | null
          numero_autorizacion?: string | null
          proveedor?: string | null
          regimen: string
          registro_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          serie?: string | null
          tipo?: string
          updated_at?: string
          uuid_fiscal?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          error?: string | null
          estado?: string
          fecha_certificacion?: string | null
          id?: string
          numero?: string | null
          numero_autorizacion?: string | null
          proveedor?: string | null
          regimen?: string
          registro_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          serie?: string | null
          tipo?: string
          updated_at?: string
          uuid_fiscal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_fiscales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_fiscales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_fiscales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "documentos_fiscales_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros"
            referencedColumns: ["id"]
          },
        ]
      }
      ejecuciones_mantenimiento: {
        Row: {
          company_id: string
          costo_real: number | null
          created_at: string
          estado: string
          fecha: string
          id: string
          observaciones: string | null
          plan_id: string
          realizado_por: string | null
        }
        Insert: {
          company_id: string
          costo_real?: number | null
          created_at?: string
          estado?: string
          fecha: string
          id?: string
          observaciones?: string | null
          plan_id: string
          realizado_por?: string | null
        }
        Update: {
          company_id?: string
          costo_real?: number | null
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          observaciones?: string | null
          plan_id?: string
          realizado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ejecuciones_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ejecuciones_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ejecuciones_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ejecuciones_mantenimiento_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "planes_mantenimiento"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          company_id: string | null
          error_message: string | null
          from_email: string | null
          id: number
          is_superadmin: boolean
          sent_at: string
          status: string
          template_key: string
          to_email: string
          triggered_by: string | null
        }
        Insert: {
          company_id?: string | null
          error_message?: string | null
          from_email?: string | null
          id?: number
          is_superadmin?: boolean
          sent_at?: string
          status: string
          template_key: string
          to_email: string
          triggered_by?: string | null
        }
        Update: {
          company_id?: string | null
          error_message?: string | null
          from_email?: string | null
          id?: number
          is_superadmin?: boolean
          sent_at?: string
          status?: string
          template_key?: string
          to_email?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_send_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      email_send_queue: {
        Row: {
          attempts: number
          company_id: string | null
          created_at: string
          id: number
          is_superadmin: boolean
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          payload: Json
          status: string
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id?: string | null
          created_at?: string
          id?: number
          is_superadmin?: boolean
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload: Json
          status?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string | null
          created_at?: string
          id?: number
          is_superadmin?: boolean
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          status?: string
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_send_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_send_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      email_templates: {
        Row: {
          company_id: string | null
          created_at: string
          html_body: string
          id: string
          is_active: boolean
          is_superadmin: boolean
          subject: string
          template_key: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          html_body: string
          id?: string
          is_active?: boolean
          is_superadmin?: boolean
          subject: string
          template_key: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          html_body?: string
          id?: string
          is_active?: boolean
          is_superadmin?: boolean
          subject?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      empresa: {
        Row: {
          created_at: string | null
          direccion: string | null
          id: string
          logo_url: string | null
          nit: string | null
          nombre: string
          telefono: string | null
        }
        Insert: {
          created_at?: string | null
          direccion?: string | null
          id?: string
          logo_url?: string | null
          nit?: string | null
          nombre: string
          telefono?: string | null
        }
        Update: {
          created_at?: string | null
          direccion?: string | null
          id?: string
          logo_url?: string | null
          nit?: string | null
          nombre?: string
          telefono?: string | null
        }
        Relationships: []
      }
      empresa_pagos_config: {
        Row: {
          company_id: string
          configured_at: string | null
          configured_by: string | null
          id: string
          provider: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          configured_at?: string | null
          configured_by?: string | null
          id?: string
          provider: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          configured_at?: string | null
          configured_by?: string | null
          id?: string
          provider?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empresa_pagos_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_pagos_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_pagos_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      encuestas: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          preguntas: Json
          project_id: string
          titulo: string
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          preguntas?: Json
          project_id: string
          titulo: string
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          preguntas?: Json
          project_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "encuestas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encuestas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encuestas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "encuestas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      entrega_unidades: {
        Row: {
          company_id: string
          condicion_general: string
          created_at: string
          fecha: string
          firmado_inquilino: boolean
          firmado_propietario: boolean
          id: string
          inquilino: string | null
          inventario_items: Json
          observaciones: string | null
          project_id: string
          propietario: string | null
          representante_admin: string | null
          tipo: string
          unidad_id: string
        }
        Insert: {
          company_id: string
          condicion_general?: string
          created_at?: string
          fecha?: string
          firmado_inquilino?: boolean
          firmado_propietario?: boolean
          id?: string
          inquilino?: string | null
          inventario_items?: Json
          observaciones?: string | null
          project_id: string
          propietario?: string | null
          representante_admin?: string | null
          tipo?: string
          unidad_id: string
        }
        Update: {
          company_id?: string
          condicion_general?: string
          created_at?: string
          fecha?: string
          firmado_inquilino?: boolean
          firmado_propietario?: boolean
          id?: string
          inquilino?: string | null
          inventario_items?: Json
          observaciones?: string | null
          project_id?: string
          propietario?: string | null
          representante_admin?: string | null
          tipo?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entrega_unidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entrega_unidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entrega_unidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "entrega_unidades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entrega_unidades_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      equipos_comunes: {
        Row: {
          categoria: string
          company_id: string
          created_at: string
          estado: string
          fecha_compra: string | null
          id: string
          marca: string | null
          modelo: string | null
          nombre: string
          notas: string | null
          project_id: string
          proximo_mantenimiento: string | null
          serial: string | null
          ubicacion: string | null
          ultimo_mantenimiento: string | null
          valor_compra: number | null
          vida_util_anios: number | null
        }
        Insert: {
          categoria?: string
          company_id: string
          created_at?: string
          estado?: string
          fecha_compra?: string | null
          id?: string
          marca?: string | null
          modelo?: string | null
          nombre: string
          notas?: string | null
          project_id: string
          proximo_mantenimiento?: string | null
          serial?: string | null
          ubicacion?: string | null
          ultimo_mantenimiento?: string | null
          valor_compra?: number | null
          vida_util_anios?: number | null
        }
        Update: {
          categoria?: string
          company_id?: string
          created_at?: string
          estado?: string
          fecha_compra?: string | null
          id?: string
          marca?: string | null
          modelo?: string | null
          nombre?: string
          notas?: string | null
          project_id?: string
          proximo_mantenimiento?: string | null
          serial?: string | null
          ubicacion?: string | null
          ultimo_mantenimiento?: string | null
          valor_compra?: number | null
          vida_util_anios?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "equipos_comunes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipos_comunes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipos_comunes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "equipos_comunes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      estacionamiento_visita: {
        Row: {
          autorizado_por: string | null
          company_id: string
          created_at: string
          espacio: string
          hora_entrada: string
          hora_salida: string | null
          id: string
          notas: string | null
          placa: string
          project_id: string
          tipo_vehiculo: string
          unidad_visitada: string | null
          visitante_nombre: string | null
        }
        Insert: {
          autorizado_por?: string | null
          company_id: string
          created_at?: string
          espacio: string
          hora_entrada?: string
          hora_salida?: string | null
          id?: string
          notas?: string | null
          placa: string
          project_id: string
          tipo_vehiculo?: string
          unidad_visitada?: string | null
          visitante_nombre?: string | null
        }
        Update: {
          autorizado_por?: string | null
          company_id?: string
          created_at?: string
          espacio?: string
          hora_entrada?: string
          hora_salida?: string | null
          id?: string
          notas?: string | null
          placa?: string
          project_id?: string
          tipo_vehiculo?: string
          unidad_visitada?: string | null
          visitante_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estacionamiento_visita_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estacionamiento_visita_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estacionamiento_visita_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "estacionamiento_visita_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estacionamiento_visita_unidad_visitada_fkey"
            columns: ["unidad_visitada"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluaciones_proveedor: {
        Row: {
          calidad: number | null
          calificacion: number
          comentarios: string | null
          company_id: string
          created_at: string
          evaluado_por: string | null
          fecha: string
          id: string
          nombre_proveedor: string
          precio: number | null
          project_id: string
          proveedor_id: string | null
          puntualidad: number | null
        }
        Insert: {
          calidad?: number | null
          calificacion: number
          comentarios?: string | null
          company_id: string
          created_at?: string
          evaluado_por?: string | null
          fecha?: string
          id?: string
          nombre_proveedor: string
          precio?: number | null
          project_id: string
          proveedor_id?: string | null
          puntualidad?: number | null
        }
        Update: {
          calidad?: number | null
          calificacion?: number
          comentarios?: string | null
          company_id?: string
          created_at?: string
          evaluado_por?: string | null
          fecha?: string
          id?: string
          nombre_proveedor?: string
          precio?: number | null
          project_id?: string
          proveedor_id?: string | null
          puntualidad?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluaciones_proveedor_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluaciones_proveedor_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluaciones_proveedor_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "evaluaciones_proveedor_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluaciones_proveedor_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "contratos_proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_calendario: {
        Row: {
          color: string
          company_id: string
          created_at: string
          created_by: string | null
          descripcion: string | null
          fecha_fin: string | null
          fecha_inicio: string
          frecuencia: string | null
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          project_id: string
          recurrente: boolean
          tipo: string
          titulo: string
          todo_el_dia: boolean
        }
        Insert: {
          color?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio: string
          frecuencia?: string | null
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          project_id: string
          recurrente?: boolean
          tipo?: string
          titulo: string
          todo_el_dia?: boolean
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string
          frecuencia?: string | null
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          project_id?: string
          recurrente?: boolean
          tipo?: string
          titulo?: string
          todo_el_dia?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "eventos_calendario_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_calendario_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_calendario_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "eventos_calendario_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_calendario_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_comunidad: {
        Row: {
          asistentes_real: number | null
          capacidad_max: number | null
          company_id: string
          costo_estimado: number | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          lugar: string | null
          project_id: string
          tipo: string
          titulo: string
        }
        Insert: {
          asistentes_real?: number | null
          capacidad_max?: number | null
          company_id: string
          costo_estimado?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          lugar?: string | null
          project_id: string
          tipo?: string
          titulo: string
        }
        Update: {
          asistentes_real?: number | null
          capacidad_max?: number | null
          company_id?: string
          costo_estimado?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          lugar?: string | null
          project_id?: string
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_comunidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_comunidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_comunidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "eventos_comunidad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas_energia: {
        Row: {
          archivo_factura_url: string | null
          company_id: string
          created_at: string | null
          estado: string
          fecha_emision: string | null
          fecha_pago: string | null
          fuente_energia_id: string
          id: string
          kw_demanda_max: number | null
          kwh_consumidos: number
          kwh_exportados: number
          kwh_generados: number
          moneda: string
          monto_alumbrado: number
          monto_cargo_fijo: number
          monto_credito_exportacion: number
          monto_energia: number
          monto_iva: number
          monto_otros: number
          monto_potencia: number
          monto_total: number
          notas: string | null
          numero_factura: string | null
          periodo_fin: string
          periodo_inicio: string
          project_id: string
          proveedor_id: string | null
          tarifa_id: string | null
          updated_at: string | null
        }
        Insert: {
          archivo_factura_url?: string | null
          company_id: string
          created_at?: string | null
          estado?: string
          fecha_emision?: string | null
          fecha_pago?: string | null
          fuente_energia_id: string
          id?: string
          kw_demanda_max?: number | null
          kwh_consumidos?: number
          kwh_exportados?: number
          kwh_generados?: number
          moneda?: string
          monto_alumbrado?: number
          monto_cargo_fijo?: number
          monto_credito_exportacion?: number
          monto_energia?: number
          monto_iva?: number
          monto_otros?: number
          monto_potencia?: number
          monto_total?: number
          notas?: string | null
          numero_factura?: string | null
          periodo_fin: string
          periodo_inicio: string
          project_id: string
          proveedor_id?: string | null
          tarifa_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archivo_factura_url?: string | null
          company_id?: string
          created_at?: string | null
          estado?: string
          fecha_emision?: string | null
          fecha_pago?: string | null
          fuente_energia_id?: string
          id?: string
          kw_demanda_max?: number | null
          kwh_consumidos?: number
          kwh_exportados?: number
          kwh_generados?: number
          moneda?: string
          monto_alumbrado?: number
          monto_cargo_fijo?: number
          monto_credito_exportacion?: number
          monto_energia?: number
          monto_iva?: number
          monto_otros?: number
          monto_potencia?: number
          monto_total?: number
          notas?: string | null
          numero_factura?: string | null
          periodo_fin?: string
          periodo_inicio?: string
          project_id?: string
          proveedor_id?: string | null
          tarifa_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "facturas_energia_fuente_energia_id_fkey"
            columns: ["fuente_energia_id"]
            isOneToOne: false
            referencedRelation: "fuentes_energia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_energia_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_energia_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores_energia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_energia_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "tarifas_energia"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas_proveedor: {
        Row: {
          aprobada_at: string | null
          aprobada_por: string | null
          categoria: string
          company_id: string
          concepto: string
          created_at: string
          created_by: string | null
          estado: string
          fecha_emision: string
          fecha_vencimiento: string | null
          id: string
          iva_monto: number
          moneda: string | null
          monto_pagado: number
          monto_total: number
          notas: string | null
          numero_factura: string | null
          project_id: string | null
          proveedor_id: string
          updated_at: string
        }
        Insert: {
          aprobada_at?: string | null
          aprobada_por?: string | null
          categoria?: string
          company_id: string
          concepto: string
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_emision?: string
          fecha_vencimiento?: string | null
          id?: string
          iva_monto?: number
          moneda?: string | null
          monto_pagado?: number
          monto_total: number
          notas?: string | null
          numero_factura?: string | null
          project_id?: string | null
          proveedor_id: string
          updated_at?: string
        }
        Update: {
          aprobada_at?: string | null
          aprobada_por?: string | null
          categoria?: string
          company_id?: string
          concepto?: string
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_emision?: string
          fecha_vencimiento?: string | null
          id?: string
          iva_monto?: number
          moneda?: string | null
          monto_pagado?: number
          monto_total?: number
          notas?: string | null
          numero_factura?: string | null
          project_id?: string | null
          proveedor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facturas_proveedor_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_proveedor_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_proveedor_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "facturas_proveedor_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_proveedor_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      firmas_digitales: {
        Row: {
          company_id: string
          created_at: string
          documento_tipo: string
          documento_titulo: string
          estado: string
          fecha_firma: string | null
          fecha_vencimiento: string | null
          firmante_email: string | null
          firmante_nombre: string | null
          id: string
          notas: string | null
          project_id: string
          unidad_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          documento_tipo?: string
          documento_titulo: string
          estado?: string
          fecha_firma?: string | null
          fecha_vencimiento?: string | null
          firmante_email?: string | null
          firmante_nombre?: string | null
          id?: string
          notas?: string | null
          project_id: string
          unidad_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          documento_tipo?: string
          documento_titulo?: string
          estado?: string
          fecha_firma?: string | null
          fecha_vencimiento?: string | null
          firmante_email?: string | null
          firmante_nombre?: string | null
          id?: string
          notas?: string | null
          project_id?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firmas_digitales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firmas_digitales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firmas_digitales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "firmas_digitales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firmas_digitales_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_pac_secrets: {
        Row: {
          company_id: string
          created_at: string
          credenciales: Json
          estado_conexion: string
          estado_mensaje: string | null
          estado_probado_en: string | null
          id: string
          project_id: string | null
          proveedor: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          credenciales?: Json
          estado_conexion?: string
          estado_mensaje?: string | null
          estado_probado_en?: string | null
          id?: string
          project_id?: string | null
          proveedor?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          credenciales?: Json
          estado_conexion?: string
          estado_mensaje?: string | null
          estado_probado_en?: string | null
          id?: string
          project_id?: string | null
          proveedor?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_pac_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_pac_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_pac_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fiscal_pac_secrets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      flujo_aprobacion_cond: {
        Row: {
          aprobado_por: string | null
          comentario_resolucion: string | null
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_resolucion: string | null
          fecha_solicitud: string
          id: string
          monto: number | null
          project_id: string
          solicitado_por: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          aprobado_por?: string | null
          comentario_resolucion?: string | null
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_resolucion?: string | null
          fecha_solicitud?: string
          id?: string
          monto?: number | null
          project_id: string
          solicitado_por?: string | null
          tipo?: string
          titulo: string
        }
        Update: {
          aprobado_por?: string | null
          comentario_resolucion?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_resolucion?: string | null
          fecha_solicitud?: string
          id?: string
          monto?: number | null
          project_id?: string
          solicitado_por?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "flujo_aprobacion_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flujo_aprobacion_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flujo_aprobacion_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "flujo_aprobacion_cond_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      fondo_reserva: {
        Row: {
          company_id: string
          concepto: string
          created_at: string
          fecha: string
          id: string
          monto: number
          notas: string | null
          project_id: string
          referencia: string | null
          tipo: string
        }
        Insert: {
          company_id: string
          concepto: string
          created_at?: string
          fecha?: string
          id?: string
          monto: number
          notas?: string | null
          project_id: string
          referencia?: string | null
          tipo: string
        }
        Update: {
          company_id?: string
          concepto?: string
          created_at?: string
          fecha?: string
          id?: string
          monto?: number
          notas?: string | null
          project_id?: string
          referencia?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "fondo_reserva_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fondo_reserva_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fondo_reserva_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fondo_reserva_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      fondo_reserva_condominio: {
        Row: {
          aprobado_por: string | null
          company_id: string
          concepto: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          estado: string
          fecha: string
          id: string
          justificacion: string | null
          monto: number
          notas: string | null
          project_id: string
          tipo: string
        }
        Insert: {
          aprobado_por?: string | null
          company_id: string
          concepto: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          estado?: string
          fecha?: string
          id?: string
          justificacion?: string | null
          monto: number
          notas?: string | null
          project_id: string
          tipo?: string
        }
        Update: {
          aprobado_por?: string | null
          company_id?: string
          concepto?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          estado?: string
          fecha?: string
          id?: string
          justificacion?: string | null
          monto?: number
          notas?: string | null
          project_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "fondo_reserva_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fondo_reserva_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fondo_reserva_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fondo_reserva_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      fuentes_agua: {
        Row: {
          activo: boolean | null
          company_id: string | null
          created_at: string | null
          descripcion: string | null
          frecuencia_muestreo_dias: number | null
          id: string
          identificador: string
          nombre: string
          tipo_agua: string
        }
        Insert: {
          activo?: boolean | null
          company_id?: string | null
          created_at?: string | null
          descripcion?: string | null
          frecuencia_muestreo_dias?: number | null
          id?: string
          identificador: string
          nombre: string
          tipo_agua: string
        }
        Update: {
          activo?: boolean | null
          company_id?: string | null
          created_at?: string | null
          descripcion?: string | null
          frecuencia_muestreo_dias?: number | null
          id?: string
          identificador?: string
          nombre?: string
          tipo_agua?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuentes_agua_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_agua_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_agua_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      fuentes_energia: {
        Row: {
          activo: boolean
          capacidad_solar_kwp: number | null
          company_id: string
          created_at: string | null
          fuente_agua_id: string | null
          id: string
          modo_suministro: string
          nombre: string
          numero_cuenta: string | null
          numero_medidor: string | null
          potencia_contratada_kw: number | null
          project_id: string
          proveedor_id: string | null
          tarifa_id: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          capacidad_solar_kwp?: number | null
          company_id: string
          created_at?: string | null
          fuente_agua_id?: string | null
          id?: string
          modo_suministro: string
          nombre: string
          numero_cuenta?: string | null
          numero_medidor?: string | null
          potencia_contratada_kw?: number | null
          project_id: string
          proveedor_id?: string | null
          tarifa_id?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          capacidad_solar_kwp?: number | null
          company_id?: string
          created_at?: string | null
          fuente_agua_id?: string | null
          id?: string
          modo_suministro?: string
          nombre?: string
          numero_cuenta?: string | null
          numero_medidor?: string | null
          potencia_contratada_kw?: number | null
          project_id?: string
          proveedor_id?: string | null
          tarifa_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fuentes_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "fuentes_energia_fuente_agua_id_fkey"
            columns: ["fuente_agua_id"]
            isOneToOne: false
            referencedRelation: "fuentes_agua"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_energia_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_energia_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores_energia"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuentes_energia_tarifa_id_fkey"
            columns: ["tarifa_id"]
            isOneToOne: false
            referencedRelation: "tarifas_energia"
            referencedColumns: ["id"]
          },
        ]
      }
      garantias_equipo: {
        Row: {
          area: string | null
          company_id: string
          contacto_soporte: string | null
          created_at: string
          equipo: string
          estado: string
          fecha_compra: string | null
          fecha_vencimiento: string | null
          id: string
          monto_compra: number | null
          notas: string | null
          numero_serie: string | null
          project_id: string
          proveedor: string | null
        }
        Insert: {
          area?: string | null
          company_id: string
          contacto_soporte?: string | null
          created_at?: string
          equipo: string
          estado?: string
          fecha_compra?: string | null
          fecha_vencimiento?: string | null
          id?: string
          monto_compra?: number | null
          notas?: string | null
          numero_serie?: string | null
          project_id: string
          proveedor?: string | null
        }
        Update: {
          area?: string | null
          company_id?: string
          contacto_soporte?: string | null
          created_at?: string
          equipo?: string
          estado?: string
          fecha_compra?: string | null
          fecha_vencimiento?: string | null
          id?: string
          monto_compra?: number | null
          notas?: string | null
          numero_serie?: string | null
          project_id?: string
          proveedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "garantias_equipo_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "garantias_equipo_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "garantias_equipo_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "garantias_equipo_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      gastos_condominio: {
        Row: {
          categoria: string
          company_id: string
          comprobante_num: string | null
          concepto: string
          created_at: string
          estado: string
          fecha: string
          id: string
          metodo_pago: string | null
          monto: number
          notas: string | null
          project_id: string
          proveedor_id: string | null
          proveedor_nombre: string | null
        }
        Insert: {
          categoria?: string
          company_id: string
          comprobante_num?: string | null
          concepto: string
          created_at?: string
          estado?: string
          fecha: string
          id?: string
          metodo_pago?: string | null
          monto: number
          notas?: string | null
          project_id: string
          proveedor_id?: string | null
          proveedor_nombre?: string | null
        }
        Update: {
          categoria?: string
          company_id?: string
          comprobante_num?: string | null
          concepto?: string
          created_at?: string
          estado?: string
          fecha?: string
          id?: string
          metodo_pago?: string | null
          monto?: number
          notas?: string | null
          project_id?: string
          proveedor_id?: string | null
          proveedor_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gastos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "gastos_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gastos_condominio_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      generacion_cuotas_log: {
        Row: {
          company_id: string
          concepto: string
          created_at: string
          fecha_vencimiento: string
          id: string
          metodo_calculo: string | null
          monto_unitario: number
          periodo: string
          project_id: string
          rubros: Json | null
          unidades_generadas: number
        }
        Insert: {
          company_id: string
          concepto: string
          created_at?: string
          fecha_vencimiento: string
          id?: string
          metodo_calculo?: string | null
          monto_unitario: number
          periodo: string
          project_id: string
          rubros?: Json | null
          unidades_generadas?: number
        }
        Update: {
          company_id?: string
          concepto?: string
          created_at?: string
          fecha_vencimiento?: string
          id?: string
          metodo_calculo?: string | null
          monto_unitario?: number
          periodo?: string
          project_id?: string
          rubros?: Json | null
          unidades_generadas?: number
        }
        Relationships: [
          {
            foreignKeyName: "generacion_cuotas_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generacion_cuotas_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generacion_cuotas_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "generacion_cuotas_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      gestion_cobranza: {
        Row: {
          company_id: string
          contactos: Json
          created_at: string
          estado: string
          etapa: string
          fecha_inicio: string
          fecha_resolucion: string | null
          id: string
          monto_adeudado: number
          monto_pagado: number
          observaciones: string | null
          project_id: string
          responsable: string
          unidad_id: string | null
        }
        Insert: {
          company_id: string
          contactos?: Json
          created_at?: string
          estado?: string
          etapa?: string
          fecha_inicio?: string
          fecha_resolucion?: string | null
          id?: string
          monto_adeudado?: number
          monto_pagado?: number
          observaciones?: string | null
          project_id: string
          responsable: string
          unidad_id?: string | null
        }
        Update: {
          company_id?: string
          contactos?: Json
          created_at?: string
          estado?: string
          etapa?: string
          fecha_inicio?: string
          fecha_resolucion?: string | null
          id?: string
          monto_adeudado?: number
          monto_pagado?: number
          observaciones?: string | null
          project_id?: string
          responsable?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gestion_cobranza_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gestion_cobranza_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gestion_cobranza_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "gestion_cobranza_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gestion_cobranza_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      historial_residentes: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          estado: string
          fecha_desde: string
          fecha_hasta: string | null
          id: string
          nombre_completo: string
          notas: string | null
          project_id: string
          telefono: string | null
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          estado?: string
          fecha_desde: string
          fecha_hasta?: string | null
          id?: string
          nombre_completo: string
          notas?: string | null
          project_id: string
          telefono?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          estado?: string
          fecha_desde?: string
          fecha_hasta?: string | null
          id?: string
          nombre_completo?: string
          notas?: string | null
          project_id?: string
          telefono?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historial_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "historial_residentes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_residentes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      historial_saldos_unidad: {
        Row: {
          cargos_periodo: number
          company_id: string
          created_at: string
          id: string
          num_cuotas_vencidas: number
          pagos_periodo: number
          periodo: string
          project_id: string
          saldo_anterior: number
          saldo_final: number
          unidad_id: string
        }
        Insert: {
          cargos_periodo?: number
          company_id: string
          created_at?: string
          id?: string
          num_cuotas_vencidas?: number
          pagos_periodo?: number
          periodo: string
          project_id: string
          saldo_anterior?: number
          saldo_final?: number
          unidad_id: string
        }
        Update: {
          cargos_periodo?: number
          company_id?: string
          created_at?: string
          id?: string
          num_cuotas_vencidas?: number
          pagos_periodo?: number
          periodo?: string
          project_id?: string
          saldo_anterior?: number
          saldo_final?: number
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historial_saldos_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_saldos_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_saldos_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "historial_saldos_unidad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_saldos_unidad_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      huespedes_str: {
        Row: {
          created_at: string
          es_menor: boolean
          fecha_nacimiento: string | null
          foto_documento_url: string | null
          foto_url: string | null
          id: string
          identificacion: string | null
          nombre: string
          reserva_str_id: string
          visitante_id: string | null
        }
        Insert: {
          created_at?: string
          es_menor?: boolean
          fecha_nacimiento?: string | null
          foto_documento_url?: string | null
          foto_url?: string | null
          id?: string
          identificacion?: string | null
          nombre: string
          reserva_str_id: string
          visitante_id?: string | null
        }
        Update: {
          created_at?: string
          es_menor?: boolean
          fecha_nacimiento?: string | null
          foto_documento_url?: string | null
          foto_url?: string | null
          id?: string
          identificacion?: string | null
          nombre?: string
          reserva_str_id?: string
          visitante_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "huespedes_str_reserva_str_id_fkey"
            columns: ["reserva_str_id"]
            isOneToOne: false
            referencedRelation: "reservas_str"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "huespedes_str_visitante_id_fkey"
            columns: ["visitante_id"]
            isOneToOne: false
            referencedRelation: "visitantes"
            referencedColumns: ["id"]
          },
        ]
      }
      incidencias_elevador: {
        Row: {
          company_id: string
          costo: number | null
          created_at: string
          descripcion: string
          elevador: string
          empresa_servicio: string | null
          estado: string
          fecha: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          observaciones: string | null
          project_id: string
          proxima_inspeccion: string | null
          tecnico: string | null
          tipo: string
        }
        Insert: {
          company_id: string
          costo?: number | null
          created_at?: string
          descripcion: string
          elevador?: string
          empresa_servicio?: string | null
          estado?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          observaciones?: string | null
          project_id: string
          proxima_inspeccion?: string | null
          tecnico?: string | null
          tipo?: string
        }
        Update: {
          company_id?: string
          costo?: number | null
          created_at?: string
          descripcion?: string
          elevador?: string
          empresa_servicio?: string | null
          estado?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          observaciones?: string | null
          project_id?: string
          proxima_inspeccion?: string | null
          tecnico?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidencias_elevador_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidencias_elevador_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidencias_elevador_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "incidencias_elevador_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      incidentes_seguridad: {
        Row: {
          area: string | null
          company_id: string
          created_at: string
          descripcion: string
          estado: string
          fecha: string
          hora: string | null
          id: string
          involucrados: string | null
          project_id: string
          reportado_por: string | null
          seguimiento: string | null
          tipo: string
        }
        Insert: {
          area?: string | null
          company_id: string
          created_at?: string
          descripcion: string
          estado?: string
          fecha?: string
          hora?: string | null
          id?: string
          involucrados?: string | null
          project_id: string
          reportado_por?: string | null
          seguimiento?: string | null
          tipo?: string
        }
        Update: {
          area?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string
          estado?: string
          fecha?: string
          hora?: string | null
          id?: string
          involucrados?: string | null
          project_id?: string
          reportado_por?: string | null
          seguimiento?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidentes_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidentes_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidentes_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "incidentes_seguridad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      informes_mensuales: {
        Row: {
          company_id: string
          created_at: string
          cuotas_morosas: number
          cuotas_pagadas: number
          estado: string
          firmado_por: string | null
          id: string
          notas: string | null
          num_incidentes: number
          num_tickets: number
          num_visitantes: number
          periodo: string
          project_id: string
          tickets_resueltos: number
          total_cuotas: number
          total_gastos: number
          total_recaudado: number
        }
        Insert: {
          company_id: string
          created_at?: string
          cuotas_morosas?: number
          cuotas_pagadas?: number
          estado?: string
          firmado_por?: string | null
          id?: string
          notas?: string | null
          num_incidentes?: number
          num_tickets?: number
          num_visitantes?: number
          periodo: string
          project_id: string
          tickets_resueltos?: number
          total_cuotas?: number
          total_gastos?: number
          total_recaudado?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          cuotas_morosas?: number
          cuotas_pagadas?: number
          estado?: string
          firmado_por?: string | null
          id?: string
          notas?: string | null
          num_incidentes?: number
          num_tickets?: number
          num_visitantes?: number
          periodo?: string
          project_id?: string
          tickets_resueltos?: number
          total_cuotas?: number
          total_gastos?: number
          total_recaudado?: number
        }
        Relationships: [
          {
            foreignKeyName: "informes_mensuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "informes_mensuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "informes_mensuales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "informes_mensuales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      infracciones_condominio: {
        Row: {
          company_id: string
          created_at: string
          descargo: string | null
          descripcion: string
          estado: string
          fecha_infraccion: string
          fecha_limite_descargo: string | null
          foto_url: string | null
          id: string
          monto_multa: number | null
          project_id: string
          reportado_por: string | null
          resolucion: string | null
          tipo: string
          unidad_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          descargo?: string | null
          descripcion: string
          estado?: string
          fecha_infraccion?: string
          fecha_limite_descargo?: string | null
          foto_url?: string | null
          id?: string
          monto_multa?: number | null
          project_id: string
          reportado_por?: string | null
          resolucion?: string | null
          tipo?: string
          unidad_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          descargo?: string | null
          descripcion?: string
          estado?: string
          fecha_infraccion?: string
          fecha_limite_descargo?: string | null
          foto_url?: string | null
          id?: string
          monto_multa?: number | null
          project_id?: string
          reportado_por?: string | null
          resolucion?: string | null
          tipo?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "infracciones_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infracciones_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infracciones_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "infracciones_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infracciones_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      inspecciones_normativas: {
        Row: {
          acciones_correctivas: string | null
          certificado_url: string | null
          company_id: string
          created_at: string
          entidad_inspectora: string | null
          fecha: string
          fecha_proxima: string | null
          foto_url: string | null
          hallazgos: string | null
          id: string
          inspector_nombre: string | null
          notas: string | null
          project_id: string
          resultado: string
          tipo: string
        }
        Insert: {
          acciones_correctivas?: string | null
          certificado_url?: string | null
          company_id: string
          created_at?: string
          entidad_inspectora?: string | null
          fecha: string
          fecha_proxima?: string | null
          foto_url?: string | null
          hallazgos?: string | null
          id?: string
          inspector_nombre?: string | null
          notas?: string | null
          project_id: string
          resultado?: string
          tipo?: string
        }
        Update: {
          acciones_correctivas?: string | null
          certificado_url?: string | null
          company_id?: string
          created_at?: string
          entidad_inspectora?: string | null
          fecha?: string
          fecha_proxima?: string | null
          foto_url?: string | null
          hallazgos?: string | null
          id?: string
          inspector_nombre?: string | null
          notas?: string | null
          project_id?: string
          resultado?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspecciones_normativas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspecciones_normativas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspecciones_normativas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "inspecciones_normativas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      inventario_condominio: {
        Row: {
          cantidad: number
          cantidad_minima: number
          categoria: string
          company_id: string
          costo_unitario: number | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha_adquisicion: string | null
          fecha_vencimiento: string | null
          foto_url: string | null
          id: string
          nombre: string
          notas: string | null
          numero_serie: string | null
          project_id: string
          proveedor: string | null
          ubicacion: string | null
          unidad_medida: string
        }
        Insert: {
          cantidad?: number
          cantidad_minima?: number
          categoria?: string
          company_id: string
          costo_unitario?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_adquisicion?: string | null
          fecha_vencimiento?: string | null
          foto_url?: string | null
          id?: string
          nombre: string
          notas?: string | null
          numero_serie?: string | null
          project_id: string
          proveedor?: string | null
          ubicacion?: string | null
          unidad_medida?: string
        }
        Update: {
          cantidad?: number
          cantidad_minima?: number
          categoria?: string
          company_id?: string
          costo_unitario?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_adquisicion?: string | null
          fecha_vencimiento?: string | null
          foto_url?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          numero_serie?: string | null
          project_id?: string
          proveedor?: string | null
          ubicacion?: string | null
          unidad_medida?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventario_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventario_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "inventario_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          company_id: string
          country_billed: string | null
          created_at: string
          currency: string
          due_date: string | null
          id: string
          paid_at: string | null
          pdf_url: string | null
          period_end: string
          period_start: string
          status: string
          stripe_invoice_id: string | null
          subscription_id: string
          subtotal_cents: number | null
          tax_amount_cents: number | null
          tax_id: string | null
          tax_id_type: string | null
        }
        Insert: {
          amount_cents: number
          company_id: string
          country_billed?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          paid_at?: string | null
          pdf_url?: string | null
          period_end: string
          period_start: string
          status: string
          stripe_invoice_id?: string | null
          subscription_id: string
          subtotal_cents?: number | null
          tax_amount_cents?: number | null
          tax_id?: string | null
          tax_id_type?: string | null
        }
        Update: {
          amount_cents?: number
          company_id?: string
          country_billed?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          paid_at?: string | null
          pdf_url?: string | null
          period_end?: string
          period_start?: string
          status?: string
          stripe_invoice_id?: string | null
          subscription_id?: string
          subtotal_cents?: number | null
          tax_amount_cents?: number | null
          tax_id?: string | null
          tax_id_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      junta_directiva: {
        Row: {
          activo: boolean
          cargo: string
          company_id: string
          created_at: string
          email: string | null
          id: string
          nombre: string
          notas: string | null
          periodo_fin: string | null
          periodo_inicio: string
          project_id: string
          telefono: string | null
          unidad_id: string | null
        }
        Insert: {
          activo?: boolean
          cargo: string
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          nombre: string
          notas?: string | null
          periodo_fin?: string | null
          periodo_inicio: string
          project_id: string
          telefono?: string | null
          unidad_id?: string | null
        }
        Update: {
          activo?: boolean
          cargo?: string
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          periodo_fin?: string | null
          periodo_inicio?: string
          project_id?: string
          telefono?: string | null
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "junta_directiva_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "junta_directiva_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "junta_directiva_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "junta_directiva_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "junta_directiva_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      lecturas_medidor_gas: {
        Row: {
          alerta_fuga: boolean
          area: string | null
          company_id: string
          consumo: number | null
          costo_total: number | null
          costo_unitario: number | null
          created_at: string
          fecha: string
          id: string
          lectura_actual: number
          lectura_anterior: number | null
          leido_por: string | null
          observaciones: string | null
          periodo: string | null
          project_id: string
          unidad_id: string | null
        }
        Insert: {
          alerta_fuga?: boolean
          area?: string | null
          company_id: string
          consumo?: number | null
          costo_total?: number | null
          costo_unitario?: number | null
          created_at?: string
          fecha?: string
          id?: string
          lectura_actual: number
          lectura_anterior?: number | null
          leido_por?: string | null
          observaciones?: string | null
          periodo?: string | null
          project_id: string
          unidad_id?: string | null
        }
        Update: {
          alerta_fuga?: boolean
          area?: string | null
          company_id?: string
          consumo?: number | null
          costo_total?: number | null
          costo_unitario?: number | null
          created_at?: string
          fecha?: string
          id?: string
          lectura_actual?: number
          lectura_anterior?: number | null
          leido_por?: string | null
          observaciones?: string | null
          periodo?: string | null
          project_id?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lecturas_medidor_gas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecturas_medidor_gas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecturas_medidor_gas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "lecturas_medidor_gas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecturas_medidor_gas_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          client_ip: string | null
          company_id: string | null
          doc_type: string
          id: string
          locale: string
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          client_ip?: string | null
          company_id?: string | null
          doc_type: string
          id?: string
          locale?: string
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          client_ip?: string | null
          company_id?: string | null
          doc_type?: string
          id?: string
          locale?: string
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_acceptances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_acceptances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          audience: string
          created_at: string
          doc_type: string
          id: string
          is_current: boolean
          locale: string
          published_at: string
          summary: string | null
          title: string
          url: string | null
          version: string
        }
        Insert: {
          audience?: string
          created_at?: string
          doc_type: string
          id?: string
          is_current?: boolean
          locale?: string
          published_at?: string
          summary?: string | null
          title: string
          url?: string | null
          version: string
        }
        Update: {
          audience?: string
          created_at?: string
          doc_type?: string
          id?: string
          is_current?: boolean
          locale?: string
          published_at?: string
          summary?: string | null
          title?: string
          url?: string | null
          version?: string
        }
        Relationships: []
      }
      libro_novedades: {
        Row: {
          company_id: string
          created_at: string
          fecha: string
          firmado: boolean
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          incidentes: Json
          novedades: string
          project_id: string
          responsable: string
          turno: string
        }
        Insert: {
          company_id: string
          created_at?: string
          fecha?: string
          firmado?: boolean
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          incidentes?: Json
          novedades: string
          project_id: string
          responsable: string
          turno?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          fecha?: string
          firmado?: boolean
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          incidentes?: Json
          novedades?: string
          project_id?: string
          responsable?: string
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "libro_novedades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "libro_novedades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "libro_novedades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "libro_novedades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      llaves_condominio: {
        Row: {
          cantidad: number
          codigo: string | null
          company_id: string
          created_at: string
          deposito_pagado: boolean
          descripcion: string
          estado: string
          fecha_devolucion: string | null
          fecha_entrega: string | null
          id: string
          monto_deposito: number | null
          notas: string | null
          project_id: string
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          cantidad?: number
          codigo?: string | null
          company_id: string
          created_at?: string
          deposito_pagado?: boolean
          descripcion: string
          estado?: string
          fecha_devolucion?: string | null
          fecha_entrega?: string | null
          id?: string
          monto_deposito?: number | null
          notas?: string | null
          project_id: string
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          cantidad?: number
          codigo?: string | null
          company_id?: string
          created_at?: string
          deposito_pagado?: boolean
          descripcion?: string
          estado?: string
          fecha_devolucion?: string | null
          fecha_entrega?: string | null
          id?: string
          monto_deposito?: number | null
          notas?: string | null
          project_id?: string
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llaves_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llaves_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llaves_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "llaves_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llaves_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      locales_comerciales: {
        Row: {
          area_m2: number | null
          company_id: string
          created_at: string
          cuota_cam: number | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          giro: string
          id: string
          inquilino_nombre: string | null
          inquilino_telefono: string | null
          notas: string | null
          numero_local: string
          piso: string | null
          porcentaje_cam: number | null
          project_id: string
          renta_base: number | null
        }
        Insert: {
          area_m2?: number | null
          company_id: string
          created_at?: string
          cuota_cam?: number | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          giro?: string
          id?: string
          inquilino_nombre?: string | null
          inquilino_telefono?: string | null
          notas?: string | null
          numero_local: string
          piso?: string | null
          porcentaje_cam?: number | null
          project_id: string
          renta_base?: number | null
        }
        Update: {
          area_m2?: number | null
          company_id?: string
          created_at?: string
          cuota_cam?: number | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          giro?: string
          id?: string
          inquilino_nombre?: string | null
          inquilino_telefono?: string | null
          notas?: string | null
          numero_local?: string
          piso?: string | null
          porcentaje_cam?: number | null
          project_id?: string
          renta_base?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "locales_comerciales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locales_comerciales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locales_comerciales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "locales_comerciales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mantenimiento_cisterna: {
        Row: {
          cisterna: string
          cloro_residual: number | null
          company_id: string
          costo: number | null
          created_at: string
          empresa_servicio: string | null
          estado: string
          fecha: string
          id: string
          nivel_agua_pct: number | null
          observaciones: string | null
          ph: number | null
          project_id: string
          proxima_revision: string | null
          tecnico: string | null
          tipo: string
        }
        Insert: {
          cisterna?: string
          cloro_residual?: number | null
          company_id: string
          costo?: number | null
          created_at?: string
          empresa_servicio?: string | null
          estado?: string
          fecha?: string
          id?: string
          nivel_agua_pct?: number | null
          observaciones?: string | null
          ph?: number | null
          project_id: string
          proxima_revision?: string | null
          tecnico?: string | null
          tipo?: string
        }
        Update: {
          cisterna?: string
          cloro_residual?: number | null
          company_id?: string
          costo?: number | null
          created_at?: string
          empresa_servicio?: string | null
          estado?: string
          fecha?: string
          id?: string
          nivel_agua_pct?: number | null
          observaciones?: string | null
          ph?: number | null
          project_id?: string
          proxima_revision?: string | null
          tecnico?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "mantenimiento_cisterna_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mantenimiento_cisterna_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mantenimiento_cisterna_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "mantenimiento_cisterna_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mantenimiento_jardineria: {
        Row: {
          areas: string[]
          company_id: string
          costo: number | null
          created_at: string
          estado: string
          fecha: string
          horas_trabajo: number | null
          id: string
          insumos: string | null
          observaciones: string | null
          project_id: string
          proveedor: string | null
          proxima_visita: string | null
          tipo: string
          trabajadores: number | null
        }
        Insert: {
          areas?: string[]
          company_id: string
          costo?: number | null
          created_at?: string
          estado?: string
          fecha?: string
          horas_trabajo?: number | null
          id?: string
          insumos?: string | null
          observaciones?: string | null
          project_id: string
          proveedor?: string | null
          proxima_visita?: string | null
          tipo?: string
          trabajadores?: number | null
        }
        Update: {
          areas?: string[]
          company_id?: string
          costo?: number | null
          created_at?: string
          estado?: string
          fecha?: string
          horas_trabajo?: number | null
          id?: string
          insumos?: string | null
          observaciones?: string | null
          project_id?: string
          proveedor?: string | null
          proxima_visita?: string | null
          tipo?: string
          trabajadores?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mantenimiento_jardineria_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mantenimiento_jardineria_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mantenimiento_jardineria_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "mantenimiento_jardineria_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_residente_cond: {
        Row: {
          activo: boolean
          company_id: string
          contenido: string
          created_at: string
          id: string
          orden: number
          project_id: string
          seccion: string
          titulo: string
        }
        Insert: {
          activo?: boolean
          company_id: string
          contenido: string
          created_at?: string
          id?: string
          orden?: number
          project_id: string
          seccion?: string
          titulo: string
        }
        Update: {
          activo?: boolean
          company_id?: string
          contenido?: string
          created_at?: string
          id?: string
          orden?: number
          project_id?: string
          seccion?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_residente_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_residente_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_residente_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "manual_residente_cond_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mascotas: {
        Row: {
          activo: boolean
          color: string | null
          company_id: string
          created_at: string
          especie: string
          fecha_nacimiento: string | null
          fecha_ultima_vacuna: string | null
          foto_url: string | null
          id: string
          nombre: string
          notas: string | null
          project_id: string
          raza: string | null
          unidad_id: string
        }
        Insert: {
          activo?: boolean
          color?: string | null
          company_id: string
          created_at?: string
          especie?: string
          fecha_nacimiento?: string | null
          fecha_ultima_vacuna?: string | null
          foto_url?: string | null
          id?: string
          nombre: string
          notas?: string | null
          project_id: string
          raza?: string | null
          unidad_id: string
        }
        Update: {
          activo?: boolean
          color?: string | null
          company_id?: string
          created_at?: string
          especie?: string
          fecha_nacimiento?: string | null
          fecha_ultima_vacuna?: string | null
          foto_url?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          project_id?: string
          raza?: string | null
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mascotas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mascotas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mascotas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "mascotas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mascotas_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      medidores_unidad: {
        Row: {
          activo: boolean
          company_id: string
          contador_id: string
          created_at: string
          id: string
          notas: string | null
          project_id: string
          unidad_id: string
        }
        Insert: {
          activo?: boolean
          company_id: string
          contador_id: string
          created_at?: string
          id?: string
          notas?: string | null
          project_id: string
          unidad_id: string
        }
        Update: {
          activo?: boolean
          company_id?: string
          contador_id?: string
          created_at?: string
          id?: string
          notas?: string | null
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medidores_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medidores_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medidores_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "medidores_unidad_contador_id_fkey"
            columns: ["contador_id"]
            isOneToOne: false
            referencedRelation: "contadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medidores_unidad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medidores_unidad_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      memoria_labores: {
        Row: {
          company_id: string
          created_at: string
          cuotas_cobradas: number | null
          estado: string
          id: string
          incidencias_atendidas: number | null
          logros: string | null
          pendientes: string | null
          periodo: string
          project_id: string
          publicado_por: string | null
          resumen: string | null
          tickets_resueltos: number | null
          tipo_periodo: string
          titulo: string
          visitantes_registrados: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          cuotas_cobradas?: number | null
          estado?: string
          id?: string
          incidencias_atendidas?: number | null
          logros?: string | null
          pendientes?: string | null
          periodo: string
          project_id: string
          publicado_por?: string | null
          resumen?: string | null
          tickets_resueltos?: number | null
          tipo_periodo?: string
          titulo: string
          visitantes_registrados?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          cuotas_cobradas?: number | null
          estado?: string
          id?: string
          incidencias_atendidas?: number | null
          logros?: string | null
          pendientes?: string | null
          periodo?: string
          project_id?: string
          publicado_por?: string | null
          resumen?: string | null
          tickets_resueltos?: number | null
          tipo_periodo?: string
          titulo?: string
          visitantes_registrados?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "memoria_labores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memoria_labores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memoria_labores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "memoria_labores_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      mensajes_portal: {
        Row: {
          asunto: string
          company_id: string
          created_at: string
          cuerpo: string
          estado: string
          id: string
          project_id: string
          respondido_en: string | null
          respuesta: string | null
          tipo: string
          unidad_id: string
        }
        Insert: {
          asunto: string
          company_id: string
          created_at?: string
          cuerpo: string
          estado?: string
          id?: string
          project_id: string
          respondido_en?: string | null
          respuesta?: string | null
          tipo?: string
          unidad_id: string
        }
        Update: {
          asunto?: string
          company_id?: string
          created_at?: string
          cuerpo?: string
          estado?: string
          id?: string
          project_id?: string
          respondido_en?: string | null
          respuesta?: string | null
          tipo?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_portal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_portal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_portal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "mensajes_portal_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_portal_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos_caja: {
        Row: {
          caja_id: string
          company_id: string
          comprobante: string | null
          concepto: string
          created_at: string
          fecha: string
          id: string
          monto: number
          registrado_por: string | null
          tipo: string
        }
        Insert: {
          caja_id: string
          company_id: string
          comprobante?: string | null
          concepto: string
          created_at?: string
          fecha?: string
          id?: string
          monto: number
          registrado_por?: string | null
          tipo: string
        }
        Update: {
          caja_id?: string
          company_id?: string
          comprobante?: string | null
          concepto?: string
          created_at?: string
          fecha?: string
          id?: string
          monto?: number
          registrado_por?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_caja_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "caja_chica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_caja_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_caja_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_caja_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      movimientos_suministro: {
        Row: {
          area_destino: string | null
          cantidad: number
          company_id: string
          created_at: string
          fecha: string
          id: string
          motivo: string | null
          notas: string | null
          realizado_por: string | null
          suministro_id: string
          tipo: string
        }
        Insert: {
          area_destino?: string | null
          cantidad: number
          company_id: string
          created_at?: string
          fecha?: string
          id?: string
          motivo?: string | null
          notas?: string | null
          realizado_por?: string | null
          suministro_id: string
          tipo?: string
        }
        Update: {
          area_destino?: string | null
          cantidad?: number
          company_id?: string
          created_at?: string
          fecha?: string
          id?: string
          motivo?: string | null
          notas?: string | null
          realizado_por?: string | null
          suministro_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_suministro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_suministro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_suministro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "movimientos_suministro_suministro_id_fkey"
            columns: ["suministro_id"]
            isOneToOne: false
            referencedRelation: "suministros_condominio"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_admin: {
        Row: {
          autor: string | null
          categoria: string
          company_id: string
          contenido: string
          created_at: string
          fecha_recordatorio: string | null
          fijada: boolean
          id: string
          prioridad: string
          project_id: string
          resuelta: boolean
          titulo: string
        }
        Insert: {
          autor?: string | null
          categoria?: string
          company_id: string
          contenido: string
          created_at?: string
          fecha_recordatorio?: string | null
          fijada?: boolean
          id?: string
          prioridad?: string
          project_id: string
          resuelta?: boolean
          titulo: string
        }
        Update: {
          autor?: string | null
          categoria?: string
          company_id?: string
          contenido?: string
          created_at?: string
          fecha_recordatorio?: string | null
          fijada?: boolean
          id?: string
          prioridad?: string
          project_id?: string
          resuelta?: boolean
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "notas_admin_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_admin_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_admin_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "notas_admin_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notificaciones_enviadas: {
        Row: {
          asunto: string | null
          canal: string
          cliente_id: string | null
          company_id: string
          contenido: string
          created_at: string
          destinatario: string
          enviado_por: string | null
          error_detalle: string | null
          estado: string
          fecha_envio: string
          id: string
          project_id: string | null
          unidad_id: string | null
        }
        Insert: {
          asunto?: string | null
          canal?: string
          cliente_id?: string | null
          company_id: string
          contenido: string
          created_at?: string
          destinatario: string
          enviado_por?: string | null
          error_detalle?: string | null
          estado?: string
          fecha_envio?: string
          id?: string
          project_id?: string | null
          unidad_id?: string | null
        }
        Update: {
          asunto?: string | null
          canal?: string
          cliente_id?: string | null
          company_id?: string
          contenido?: string
          created_at?: string
          destinatario?: string
          enviado_por?: string | null
          error_detalle?: string | null
          estado?: string
          fecha_envio?: string
          id?: string
          project_id?: string | null
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_enviadas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_enviadas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_enviadas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_enviadas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "notificaciones_enviadas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_enviadas_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          created_at: string
          detail: Json
          event_type: string
          id: string
          outbox_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          outbox_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          outbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "notifications_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          company_id: string | null
          created_at: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          company_id?: string | null
          created_at?: string
          enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          company_id?: string | null
          created_at?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          company_id: string | null
          created_at: string
          id: string
          is_active: boolean
          key: string
          locale: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel: string
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          locale?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: string
          company_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          locale?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      notifications_outbox: {
        Row: {
          attempts: number
          channel: string
          company_id: string | null
          created_at: string
          delivered_at: string | null
          id: string
          last_error: string | null
          max_attempts: number
          payload: Json
          read_at: string | null
          recipient: string | null
          scheduled_at: string
          sent_at: string | null
          status: string
          suppressed_at: string | null
          template_key: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          company_id?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          read_at?: string | null
          recipient?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          suppressed_at?: string | null
          template_key?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          company_id?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          payload?: Json
          read_at?: string | null
          recipient?: string | null
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          suppressed_at?: string | null
          template_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      novedades_seguridad: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string
          foto_url: string | null
          fotos: string[] | null
          id: string
          prioridad: string
          project_id: string
          reportado_por: string | null
          ronda_id: string | null
          tipo: string
          ubicacion: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion: string
          foto_url?: string | null
          fotos?: string[] | null
          id?: string
          prioridad?: string
          project_id: string
          reportado_por?: string | null
          ronda_id?: string | null
          tipo?: string
          ubicacion?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string
          foto_url?: string | null
          fotos?: string[] | null
          id?: string
          prioridad?: string
          project_id?: string
          reportado_por?: string | null
          ronda_id?: string | null
          tipo?: string
          ubicacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "novedades_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "novedades_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "novedades_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "novedades_seguridad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "novedades_seguridad_ronda_id_fkey"
            columns: ["ronda_id"]
            isOneToOne: false
            referencedRelation: "rondas_seguridad"
            referencedColumns: ["id"]
          },
        ]
      }
      objetos_perdidos: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string
          estado: string
          fecha_encontrado: string
          fecha_reclamo: string | null
          foto_url: string | null
          id: string
          lugar_encontrado: string | null
          notas: string | null
          project_id: string
          reclamado_por: string | null
          registrado_por: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion: string
          estado?: string
          fecha_encontrado?: string
          fecha_reclamo?: string | null
          foto_url?: string | null
          id?: string
          lugar_encontrado?: string | null
          notas?: string | null
          project_id: string
          reclamado_por?: string | null
          registrado_por?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string
          estado?: string
          fecha_encontrado?: string
          fecha_reclamo?: string | null
          foto_url?: string | null
          id?: string
          lugar_encontrado?: string | null
          notas?: string | null
          project_id?: string
          reclamado_por?: string | null
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objetos_perdidos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objetos_perdidos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "objetos_perdidos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "objetos_perdidos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      obras_mejoras: {
        Row: {
          area: string | null
          company_id: string
          contratista: string | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha_fin_estimada: string | null
          fecha_fin_real: string | null
          fecha_inicio: string | null
          id: string
          monto_contrato: number | null
          notas: string | null
          progreso: number
          project_id: string
          titulo: string
        }
        Insert: {
          area?: string | null
          company_id: string
          contratista?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_fin_estimada?: string | null
          fecha_fin_real?: string | null
          fecha_inicio?: string | null
          id?: string
          monto_contrato?: number | null
          notas?: string | null
          progreso?: number
          project_id: string
          titulo: string
        }
        Update: {
          area?: string | null
          company_id?: string
          contratista?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_fin_estimada?: string | null
          fecha_fin_real?: string | null
          fecha_inicio?: string | null
          id?: string
          monto_contrato?: number | null
          notas?: string | null
          progreso?: number
          project_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "obras_mejoras_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obras_mejoras_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "obras_mejoras_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "obras_mejoras_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_residentes: {
        Row: {
          accesos_configurados: boolean
          bienvenida_enviada: boolean
          company_id: string
          created_at: string
          datos_registrados: boolean
          deposito_pagado: boolean
          estado: string
          fecha_ingreso: string
          id: string
          inspeccion_unidad: boolean
          llaves_entregadas: boolean
          nombre_residente: string
          notas: string | null
          project_id: string
          reglamento_firmado: boolean
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          accesos_configurados?: boolean
          bienvenida_enviada?: boolean
          company_id: string
          created_at?: string
          datos_registrados?: boolean
          deposito_pagado?: boolean
          estado?: string
          fecha_ingreso: string
          id?: string
          inspeccion_unidad?: boolean
          llaves_entregadas?: boolean
          nombre_residente: string
          notas?: string | null
          project_id: string
          reglamento_firmado?: boolean
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          accesos_configurados?: boolean
          bienvenida_enviada?: boolean
          company_id?: string
          created_at?: string
          datos_registrados?: boolean
          deposito_pagado?: boolean
          estado?: string
          fecha_ingreso?: string
          id?: string
          inspeccion_unidad?: boolean
          llaves_entregadas?: boolean
          nombre_residente?: string
          notas?: string | null
          project_id?: string
          reglamento_firmado?: boolean
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "onboarding_residentes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_residentes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_compra: {
        Row: {
          company_id: string
          concepto: string
          correlativo: number
          created_at: string | null
          created_by: string | null
          descripcion: string | null
          estado: string
          fecha_entrega_esperada: string | null
          id: string
          monto_estimado: number | null
          monto_real: number | null
          notas: string | null
          project_id: string
          proveedor_nombre: string
        }
        Insert: {
          company_id: string
          concepto: string
          correlativo?: number
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_entrega_esperada?: string | null
          id?: string
          monto_estimado?: number | null
          monto_real?: number | null
          notas?: string | null
          project_id: string
          proveedor_nombre: string
        }
        Update: {
          company_id?: string
          concepto?: string
          correlativo?: number
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_entrega_esperada?: string | null
          id?: string
          monto_estimado?: number | null
          monto_real?: number | null
          notas?: string | null
          project_id?: string
          proveedor_nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ordenes_compra_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_pago: {
        Row: {
          aprobada_at: string | null
          aprobada_por: string | null
          company_id: string
          created_at: string
          estado: string
          factura_id: string
          fecha_pago: string | null
          id: string
          metodo_pago: string
          monto: number
          notas: string | null
          pagada_at: string | null
          project_id: string | null
          proveedor_id: string
          referencia: string | null
          solicitada_por: string | null
          updated_at: string
        }
        Insert: {
          aprobada_at?: string | null
          aprobada_por?: string | null
          company_id: string
          created_at?: string
          estado?: string
          factura_id: string
          fecha_pago?: string | null
          id?: string
          metodo_pago?: string
          monto: number
          notas?: string | null
          pagada_at?: string | null
          project_id?: string | null
          proveedor_id: string
          referencia?: string | null
          solicitada_por?: string | null
          updated_at?: string
        }
        Update: {
          aprobada_at?: string | null
          aprobada_por?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          factura_id?: string
          fecha_pago?: string | null
          id?: string
          metodo_pago?: string
          monto?: number
          notas?: string | null
          pagada_at?: string | null
          project_id?: string | null
          proveedor_id?: string
          referencia?: string | null
          solicitada_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ordenes_pago_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturas_proveedor"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_pago_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores"
            referencedColumns: ["id"]
          },
        ]
      }
      pagos: {
        Row: {
          boleta_url: string | null
          cliente_id: string
          comprobante_tipo: string | null
          comprobante_url: string | null
          convenio_id: string | null
          created_at: string | null
          created_by: string | null
          cuota_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          estado: string
          id: string
          metodo: string
          monto: number
          notas: string | null
          numero_documento: string | null
          paypal_order_id: string | null
          paypal_transaction_id: string | null
          project_id: string | null
          referencia: string | null
          registro_id: string | null
          stripe_payment_intent_id: string | null
          tipo_aplicacion: string | null
          updated_at: string | null
          verification_notes: string | null
          verification_status: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          boleta_url?: string | null
          cliente_id: string
          comprobante_tipo?: string | null
          comprobante_url?: string | null
          convenio_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cuota_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          estado?: string
          id?: string
          metodo: string
          monto: number
          notas?: string | null
          numero_documento?: string | null
          paypal_order_id?: string | null
          paypal_transaction_id?: string | null
          project_id?: string | null
          referencia?: string | null
          registro_id?: string | null
          stripe_payment_intent_id?: string | null
          tipo_aplicacion?: string | null
          updated_at?: string | null
          verification_notes?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          boleta_url?: string | null
          cliente_id?: string
          comprobante_tipo?: string | null
          comprobante_url?: string | null
          convenio_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cuota_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          estado?: string
          id?: string
          metodo?: string
          monto?: number
          notas?: string | null
          numero_documento?: string | null
          paypal_order_id?: string | null
          paypal_transaction_id?: string | null
          project_id?: string | null
          referencia?: string | null
          registro_id?: string | null
          stripe_payment_intent_id?: string | null
          tipo_aplicacion?: string | null
          updated_at?: string | null
          verification_notes?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_convenio_id_fkey"
            columns: ["convenio_id"]
            isOneToOne: false
            referencedRelation: "convenios_pago"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros"
            referencedColumns: ["id"]
          },
        ]
      }
      paquetes_recibidos: {
        Row: {
          autorizado_documento: string | null
          autorizado_nombre: string | null
          autorizado_telefono: string | null
          codigo_retiro: string | null
          company_id: string
          created_at: string
          descripcion: string
          direccion: string
          empresa_mensajeria: string | null
          entregado_a_nombre: string | null
          entregado_por: string | null
          entregado_via: string | null
          estado: string
          firma_path: string | null
          fotos: string[] | null
          hora_entrega: string | null
          hora_recepcion: string
          id: string
          notas: string | null
          notificado_at: string | null
          num_guia: string | null
          project_id: string
          recibido_por: string | null
          remitente: string | null
          tipo: string
          unidad_id: string
        }
        Insert: {
          autorizado_documento?: string | null
          autorizado_nombre?: string | null
          autorizado_telefono?: string | null
          codigo_retiro?: string | null
          company_id: string
          created_at?: string
          descripcion: string
          direccion?: string
          empresa_mensajeria?: string | null
          entregado_a_nombre?: string | null
          entregado_por?: string | null
          entregado_via?: string | null
          estado?: string
          firma_path?: string | null
          fotos?: string[] | null
          hora_entrega?: string | null
          hora_recepcion?: string
          id?: string
          notas?: string | null
          notificado_at?: string | null
          num_guia?: string | null
          project_id: string
          recibido_por?: string | null
          remitente?: string | null
          tipo?: string
          unidad_id: string
        }
        Update: {
          autorizado_documento?: string | null
          autorizado_nombre?: string | null
          autorizado_telefono?: string | null
          codigo_retiro?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string
          direccion?: string
          empresa_mensajeria?: string | null
          entregado_a_nombre?: string | null
          entregado_por?: string | null
          entregado_via?: string | null
          estado?: string
          firma_path?: string | null
          fotos?: string[] | null
          hora_entrega?: string | null
          hora_recepcion?: string
          id?: string
          notas?: string | null
          notificado_at?: string | null
          num_guia?: string | null
          project_id?: string
          recibido_por?: string | null
          remitente?: string | null
          tipo?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paquetes_recibidos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paquetes_recibidos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paquetes_recibidos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "paquetes_recibidos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paquetes_recibidos_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      parqueos_condominio: {
        Row: {
          activo: boolean
          color_vehiculo: string | null
          company_id: string
          created_at: string
          id: string
          marca_vehiculo: string | null
          notas: string | null
          numero: string
          placa_vehiculo: string | null
          project_id: string
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          activo?: boolean
          color_vehiculo?: string | null
          company_id: string
          created_at?: string
          id?: string
          marca_vehiculo?: string | null
          notas?: string | null
          numero: string
          placa_vehiculo?: string | null
          project_id: string
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          activo?: boolean
          color_vehiculo?: string | null
          company_id?: string
          created_at?: string
          id?: string
          marca_vehiculo?: string | null
          notas?: string | null
          numero?: string
          placa_vehiculo?: string | null
          project_id?: string
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parqueos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parqueos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parqueos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "parqueos_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parqueos_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      payfac_secrets: {
        Row: {
          company_id: string
          created_at: string
          credenciales: Json
          estado_conexion: string
          estado_mensaje: string | null
          estado_probado_en: string | null
          id: string
          project_id: string | null
          proveedor: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          credenciales?: Json
          estado_conexion?: string
          estado_mensaje?: string | null
          estado_probado_en?: string | null
          id?: string
          project_id?: string | null
          proveedor?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          credenciales?: Json
          estado_conexion?: string
          estado_mensaje?: string | null
          estado_probado_en?: string | null
          id?: string
          project_id?: string | null
          proveedor?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payfac_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payfac_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payfac_secrets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payfac_secrets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          ambiente: string
          cliente_id: string
          company_id: string
          created_at: string | null
          cuota_id: string | null
          estado: string | null
          id: string
          monto: number
          notas: string | null
          numero_comprobante: string | null
          paypal_order_id: string | null
          provider: string
          provider_ref: string | null
          referencia: string | null
          registro_id: string | null
          stripe_payment_intent: string | null
          updated_at: string | null
        }
        Insert: {
          ambiente?: string
          cliente_id: string
          company_id: string
          created_at?: string | null
          cuota_id?: string | null
          estado?: string | null
          id?: string
          monto: number
          notas?: string | null
          numero_comprobante?: string | null
          paypal_order_id?: string | null
          provider: string
          provider_ref?: string | null
          referencia?: string | null
          registro_id?: string | null
          stripe_payment_intent?: string | null
          updated_at?: string | null
        }
        Update: {
          ambiente?: string
          cliente_id?: string
          company_id?: string
          created_at?: string | null
          cuota_id?: string | null
          estado?: string | null
          id?: string
          monto?: number
          notas?: string | null
          numero_comprobante?: string | null
          paypal_order_id?: string | null
          provider?: string
          provider_ref?: string | null
          referencia?: string | null
          registro_id?: string | null
          stripe_payment_intent?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_requests_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "payment_requests_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_requests_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros"
            referencedColumns: ["id"]
          },
        ]
      }
      permisos_obra_unidad: {
        Row: {
          aprobado_por: string | null
          company_id: string
          created_at: string
          descripcion: string
          estado: string
          fecha_fin_estimada: string | null
          fecha_inicio: string | null
          fianza: number | null
          horario_permitido: string | null
          id: string
          observaciones: string | null
          project_id: string
          tipo_obra: string
          unidad_id: string | null
        }
        Insert: {
          aprobado_por?: string | null
          company_id: string
          created_at?: string
          descripcion: string
          estado?: string
          fecha_fin_estimada?: string | null
          fecha_inicio?: string | null
          fianza?: number | null
          horario_permitido?: string | null
          id?: string
          observaciones?: string | null
          project_id: string
          tipo_obra?: string
          unidad_id?: string | null
        }
        Update: {
          aprobado_por?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string
          estado?: string
          fecha_fin_estimada?: string | null
          fecha_inicio?: string | null
          fianza?: number | null
          horario_permitido?: string | null
          id?: string
          observaciones?: string | null
          project_id?: string
          tipo_obra?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permisos_obra_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permisos_obra_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permisos_obra_unidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "permisos_obra_unidad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permisos_obra_unidad_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          details: Json | null
          id: number
          occurred_at: string
          target_role_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          details?: Json | null
          id?: number
          occurred_at?: string
          target_role_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          details?: Json | null
          id?: number
          occurred_at?: string
          target_role_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_audit_log_target_role_id_fkey"
            columns: ["target_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          created_at: string
          description: string | null
          key: string
          label: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          key: string
          label: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          key?: string
          label?: string
        }
        Relationships: []
      }
      personal_condominio: {
        Row: {
          alergias: string | null
          banco: string | null
          cargo: string
          codigos_acceso: Json
          company_id: string
          contactos_emergencia: Json
          created_at: string
          direccion: string | null
          dpi: string | null
          email: string | null
          equipo_asignado: Json
          estado: string
          estado_civil: string | null
          fecha_fin_contrato: string | null
          fecha_ingreso: string | null
          fecha_nacimiento: string | null
          foto_url: string | null
          genero: string | null
          id: string
          nit: string | null
          nombre: string
          notas: string | null
          numero_cuenta: string | null
          numero_igss: string | null
          numero_irtra: string | null
          project_id: string
          salario: number | null
          supervisor: string | null
          tags: string[]
          telefono: string | null
          tipo_contrato: string | null
          tipo_cuenta: string | null
          tipo_sangre: string | null
          turno: string
        }
        Insert: {
          alergias?: string | null
          banco?: string | null
          cargo?: string
          codigos_acceso?: Json
          company_id: string
          contactos_emergencia?: Json
          created_at?: string
          direccion?: string | null
          dpi?: string | null
          email?: string | null
          equipo_asignado?: Json
          estado?: string
          estado_civil?: string | null
          fecha_fin_contrato?: string | null
          fecha_ingreso?: string | null
          fecha_nacimiento?: string | null
          foto_url?: string | null
          genero?: string | null
          id?: string
          nit?: string | null
          nombre: string
          notas?: string | null
          numero_cuenta?: string | null
          numero_igss?: string | null
          numero_irtra?: string | null
          project_id: string
          salario?: number | null
          supervisor?: string | null
          tags?: string[]
          telefono?: string | null
          tipo_contrato?: string | null
          tipo_cuenta?: string | null
          tipo_sangre?: string | null
          turno?: string
        }
        Update: {
          alergias?: string | null
          banco?: string | null
          cargo?: string
          codigos_acceso?: Json
          company_id?: string
          contactos_emergencia?: Json
          created_at?: string
          direccion?: string | null
          dpi?: string | null
          email?: string | null
          equipo_asignado?: Json
          estado?: string
          estado_civil?: string | null
          fecha_fin_contrato?: string | null
          fecha_ingreso?: string | null
          fecha_nacimiento?: string | null
          foto_url?: string | null
          genero?: string | null
          id?: string
          nit?: string | null
          nombre?: string
          notas?: string | null
          numero_cuenta?: string | null
          numero_igss?: string | null
          numero_irtra?: string | null
          project_id?: string
          salario?: number | null
          supervisor?: string | null
          tags?: string[]
          telefono?: string | null
          tipo_contrato?: string | null
          tipo_cuenta?: string | null
          tipo_sangre?: string | null
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personal_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "personal_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      planes_mantenimiento: {
        Row: {
          activo: boolean
          company_id: string
          costo_estimado: number | null
          created_at: string
          descripcion: string | null
          equipo: string
          frecuencia: string
          id: string
          project_id: string
          proxima_ejecucion: string | null
          responsable: string | null
          ultima_ejecucion: string | null
        }
        Insert: {
          activo?: boolean
          company_id: string
          costo_estimado?: number | null
          created_at?: string
          descripcion?: string | null
          equipo: string
          frecuencia?: string
          id?: string
          project_id: string
          proxima_ejecucion?: string | null
          responsable?: string | null
          ultima_ejecucion?: string | null
        }
        Update: {
          activo?: boolean
          company_id?: string
          costo_estimado?: number | null
          created_at?: string
          descripcion?: string | null
          equipo?: string
          frecuencia?: string
          id?: string
          project_id?: string
          proxima_ejecucion?: string | null
          responsable?: string | null
          ultima_ejecucion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "planes_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "planes_mantenimiento_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      planes_pago_condominio: {
        Row: {
          aprobado_por: string | null
          company_id: string
          concepto: string
          created_at: string
          estado: string
          fecha_inicio: string
          id: string
          monto_cuota: number
          monto_total: number
          notas: string | null
          num_cuotas: number
          project_id: string
          unidad_id: string
        }
        Insert: {
          aprobado_por?: string | null
          company_id: string
          concepto: string
          created_at?: string
          estado?: string
          fecha_inicio?: string
          id?: string
          monto_cuota: number
          monto_total: number
          notas?: string | null
          num_cuotas?: number
          project_id: string
          unidad_id: string
        }
        Update: {
          aprobado_por?: string | null
          company_id?: string
          concepto?: string
          created_at?: string
          estado?: string
          fecha_inicio?: string
          id?: string
          monto_cuota?: number
          monto_total?: number
          notas?: string | null
          num_cuotas?: number
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planes_pago_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_pago_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_pago_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "planes_pago_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planes_pago_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      plantillas_cuota: {
        Row: {
          activa: boolean
          aplica_a: string
          company_id: string
          concepto: string
          created_at: string
          dia_vencimiento: number
          id: string
          monto: number
          monto_total_estimado: number | null
          nombre: string
          notas: string | null
          periodicidad: string
          project_id: string
          rol_responsable: string | null
          rubros: Json | null
        }
        Insert: {
          activa?: boolean
          aplica_a?: string
          company_id: string
          concepto: string
          created_at?: string
          dia_vencimiento?: number
          id?: string
          monto: number
          monto_total_estimado?: number | null
          nombre: string
          notas?: string | null
          periodicidad?: string
          project_id: string
          rol_responsable?: string | null
          rubros?: Json | null
        }
        Update: {
          activa?: boolean
          aplica_a?: string
          company_id?: string
          concepto?: string
          created_at?: string
          dia_vencimiento?: number
          id?: string
          monto?: number
          monto_total_estimado?: number | null
          nombre?: string
          notas?: string | null
          periodicidad?: string
          project_id?: string
          rol_responsable?: string | null
          rubros?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_cuota_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_cuota_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_cuota_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "plantillas_cuota_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      plantillas_mensaje_cond: {
        Row: {
          activa: boolean
          asunto: string | null
          canal: string
          company_id: string
          created_at: string
          cuerpo: string
          id: string
          nombre: string
          project_id: string
          variables: Json
        }
        Insert: {
          activa?: boolean
          asunto?: string | null
          canal?: string
          company_id: string
          created_at?: string
          cuerpo: string
          id?: string
          nombre: string
          project_id: string
          variables?: Json
        }
        Update: {
          activa?: boolean
          asunto?: string | null
          canal?: string
          company_id?: string
          created_at?: string
          cuerpo?: string
          id?: string
          nombre?: string
          project_id?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_mensaje_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_mensaje_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_mensaje_cond_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "plantillas_mensaje_cond_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      plantillas_tarea_cargo: {
        Row: {
          activo: boolean
          area_id: string | null
          cargo: string
          company_id: string
          created_at: string
          descripcion: string | null
          icono: string | null
          id: string
          orden: number | null
          project_id: string
          requiere_foto: boolean
          titulo: string
        }
        Insert: {
          activo?: boolean
          area_id?: string | null
          cargo: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          orden?: number | null
          project_id: string
          requiere_foto?: boolean
          titulo: string
        }
        Update: {
          activo?: boolean
          area_id?: string | null
          cargo?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          orden?: number | null
          project_id?: string
          requiere_foto?: boolean
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_tarea_cargo_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_tarea_cargo_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_metrics_daily: {
        Row: {
          created_at: string
          day: string
          empresas_activas: number
          mrr_cents: number
          suscripciones_vigentes: number
        }
        Insert: {
          created_at?: string
          day: string
          empresas_activas?: number
          mrr_cents?: number
          suscripciones_vigentes?: number
        }
        Update: {
          created_at?: string
          day?: string
          empresas_activas?: number
          mrr_cents?: number
          suscripciones_vigentes?: number
        }
        Relationships: []
      }
      polizas_seguro: {
        Row: {
          agente_email: string | null
          agente_nombre: string | null
          agente_telefono: string | null
          aseguradora: string
          company_id: string
          created_at: string
          descripcion: string | null
          documento_url: string | null
          estado: string
          fecha_inicio: string
          fecha_vencimiento: string
          id: string
          notas: string | null
          numero_poliza: string
          prima_anual: number | null
          project_id: string
          suma_asegurada: number | null
          tipo: string
        }
        Insert: {
          agente_email?: string | null
          agente_nombre?: string | null
          agente_telefono?: string | null
          aseguradora: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          documento_url?: string | null
          estado?: string
          fecha_inicio: string
          fecha_vencimiento: string
          id?: string
          notas?: string | null
          numero_poliza: string
          prima_anual?: number | null
          project_id: string
          suma_asegurada?: number | null
          tipo?: string
        }
        Update: {
          agente_email?: string | null
          agente_nombre?: string | null
          agente_telefono?: string | null
          aseguradora?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          documento_url?: string | null
          estado?: string
          fecha_inicio?: string
          fecha_vencimiento?: string
          id?: string
          notas?: string | null
          numero_poliza?: string
          prima_anual?: number | null
          project_id?: string
          suma_asegurada?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "polizas_seguro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_seguro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_seguro_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "polizas_seguro_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      presencia_personal: {
        Row: {
          cargo: string | null
          company_id: string
          created_at: string
          estado: string
          fecha: string
          hora_entrada: string | null
          hora_salida: string | null
          id: string
          nombre: string
          observaciones: string | null
          project_id: string
        }
        Insert: {
          cargo?: string | null
          company_id: string
          created_at?: string
          estado?: string
          fecha?: string
          hora_entrada?: string | null
          hora_salida?: string | null
          id?: string
          nombre: string
          observaciones?: string | null
          project_id: string
        }
        Update: {
          cargo?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha?: string
          hora_entrada?: string | null
          hora_salida?: string | null
          id?: string
          nombre?: string
          observaciones?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presencia_personal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presencia_personal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presencia_personal_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "presencia_personal_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      prestamos_equipo: {
        Row: {
          cantidad: number
          company_id: string
          created_at: string
          deposito: number | null
          deposito_pagado: boolean
          entregado_por: string | null
          equipo_nombre: string
          estado: string
          fecha_devolucion: string | null
          fecha_prestamo: string
          hora_devolucion: string | null
          hora_prestamo: string | null
          id: string
          observaciones: string | null
          project_id: string
          recibido_por: string | null
          unidad_id: string | null
        }
        Insert: {
          cantidad?: number
          company_id: string
          created_at?: string
          deposito?: number | null
          deposito_pagado?: boolean
          entregado_por?: string | null
          equipo_nombre: string
          estado?: string
          fecha_devolucion?: string | null
          fecha_prestamo?: string
          hora_devolucion?: string | null
          hora_prestamo?: string | null
          id?: string
          observaciones?: string | null
          project_id: string
          recibido_por?: string | null
          unidad_id?: string | null
        }
        Update: {
          cantidad?: number
          company_id?: string
          created_at?: string
          deposito?: number | null
          deposito_pagado?: boolean
          entregado_por?: string | null
          equipo_nombre?: string
          estado?: string
          fecha_devolucion?: string | null
          fecha_prestamo?: string
          hora_devolucion?: string | null
          hora_prestamo?: string | null
          id?: string
          observaciones?: string | null
          project_id?: string
          recibido_por?: string | null
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prestamos_equipo_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prestamos_equipo_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prestamos_equipo_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "prestamos_equipo_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prestamos_equipo_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      presupuesto_condominio: {
        Row: {
          anio: number
          categoria: string
          company_id: string
          created_at: string
          id: string
          monto_presupuestado: number
          notas: string | null
          project_id: string
        }
        Insert: {
          anio: number
          categoria: string
          company_id: string
          created_at?: string
          id?: string
          monto_presupuestado: number
          notas?: string | null
          project_id: string
        }
        Update: {
          anio?: number
          categoria?: string
          company_id?: string
          created_at?: string
          id?: string
          monto_presupuestado?: number
          notas?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presupuesto_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "presupuesto_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      presupuesto_partidas: {
        Row: {
          company_id: string
          cuenta_id: string
          id: string
          monto: number
          periodo: string
          presupuesto_id: string
        }
        Insert: {
          company_id: string
          cuenta_id: string
          id?: string
          monto?: number
          periodo: string
          presupuesto_id: string
        }
        Update: {
          company_id?: string
          cuenta_id?: string
          id?: string
          monto?: number
          periodo?: string
          presupuesto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presupuesto_partidas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_partidas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_partidas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "presupuesto_partidas_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "conta_cuentas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuesto_partidas_presupuesto_id_fkey"
            columns: ["presupuesto_id"]
            isOneToOne: false
            referencedRelation: "presupuestos"
            referencedColumns: ["id"]
          },
        ]
      }
      presupuestos: {
        Row: {
          anio: number
          aprobado_at: string | null
          aprobado_por: string | null
          company_id: string
          created_at: string
          created_by: string | null
          estado: string
          id: string
          nombre: string
          notas: string | null
          project_id: string | null
          updated_at: string
        }
        Insert: {
          anio: number
          aprobado_at?: string | null
          aprobado_por?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          nombre: string
          notas?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          anio?: number
          aprobado_at?: string | null
          aprobado_por?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          nombre?: string
          notas?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "presupuestos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presupuestos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "presupuestos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      proformas_condominio: {
        Row: {
          company_id: string
          concepto: string
          created_at: string | null
          descripcion: string | null
          estado: string
          fecha_validez: string | null
          id: string
          monto: number | null
          notas: string | null
          project_id: string
          proveedor_nombre: string
        }
        Insert: {
          company_id: string
          concepto: string
          created_at?: string | null
          descripcion?: string | null
          estado?: string
          fecha_validez?: string | null
          id?: string
          monto?: number | null
          notas?: string | null
          project_id: string
          proveedor_nombre: string
        }
        Update: {
          company_id?: string
          concepto?: string
          created_at?: string | null
          descripcion?: string | null
          estado?: string
          fecha_validez?: string | null
          id?: string
          monto?: number | null
          notas?: string | null
          project_id?: string
          proveedor_nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "proformas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proformas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proformas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "proformas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      programa_actividades: {
        Row: {
          activo: boolean
          categoria: string
          company_id: string
          costo: number
          created_at: string
          cupo_maximo: number | null
          descripcion: string | null
          dias_semana: string[] | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          inscritos: number
          instructor: string | null
          lugar: string | null
          nombre: string
          notas: string | null
          project_id: string
        }
        Insert: {
          activo?: boolean
          categoria?: string
          company_id: string
          costo?: number
          created_at?: string
          cupo_maximo?: number | null
          descripcion?: string | null
          dias_semana?: string[] | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          inscritos?: number
          instructor?: string | null
          lugar?: string | null
          nombre: string
          notas?: string | null
          project_id: string
        }
        Update: {
          activo?: boolean
          categoria?: string
          company_id?: string
          costo?: number
          created_at?: string
          cupo_maximo?: number | null
          descripcion?: string | null
          dias_semana?: string[] | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          inscritos?: number
          instructor?: string | null
          lugar?: string | null
          nombre?: string
          notas?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "programa_actividades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programa_actividades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programa_actividades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "programa_actividades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      programacion_limpieza: {
        Row: {
          activo: boolean
          area: string
          company_id: string
          created_at: string
          estado: string
          frecuencia: string
          id: string
          notas: string | null
          project_id: string
          proxima_ejecucion: string | null
          responsable: string | null
          ultima_ejecucion: string | null
        }
        Insert: {
          activo?: boolean
          area: string
          company_id: string
          created_at?: string
          estado?: string
          frecuencia?: string
          id?: string
          notas?: string | null
          project_id: string
          proxima_ejecucion?: string | null
          responsable?: string | null
          ultima_ejecucion?: string | null
        }
        Update: {
          activo?: boolean
          area?: string
          company_id?: string
          created_at?: string
          estado?: string
          frecuencia?: string
          id?: string
          notas?: string | null
          project_id?: string
          proxima_ejecucion?: string | null
          responsable?: string | null
          ultima_ejecucion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "programacion_limpieza_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programacion_limpieza_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programacion_limpieza_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "programacion_limpieza_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          activo: boolean
          ambiente_pago: string | null
          company_id: string
          created_at: string | null
          descripcion: string | null
          direccion: string | null
          establecimiento: string | null
          estado: string
          id: string
          latitud: number | null
          logo_url: string | null
          longitud: number | null
          lugar_expedicion: string | null
          max_unidades_apartamento: number | null
          max_unidades_bodega: number | null
          max_unidades_casa: number | null
          max_unidades_local_comercial: number | null
          max_unidades_oficina: number | null
          max_unidades_otro: number | null
          max_unidades_parqueadero: number | null
          moneda: string
          moneda_condominios: string | null
          nit: string | null
          nombre: string
          nombre_fiscal: string | null
          proveedor_pago: string | null
          proveedor_timbrado: string | null
          regimen_fiscal: string | null
          rfc: string | null
          segmento: string | null
          serie_fiscal: string | null
          tipo: string
        }
        Insert: {
          activo?: boolean
          ambiente_pago?: string | null
          company_id: string
          created_at?: string | null
          descripcion?: string | null
          direccion?: string | null
          establecimiento?: string | null
          estado?: string
          id?: string
          latitud?: number | null
          logo_url?: string | null
          longitud?: number | null
          lugar_expedicion?: string | null
          max_unidades_apartamento?: number | null
          max_unidades_bodega?: number | null
          max_unidades_casa?: number | null
          max_unidades_local_comercial?: number | null
          max_unidades_oficina?: number | null
          max_unidades_otro?: number | null
          max_unidades_parqueadero?: number | null
          moneda?: string
          moneda_condominios?: string | null
          nit?: string | null
          nombre: string
          nombre_fiscal?: string | null
          proveedor_pago?: string | null
          proveedor_timbrado?: string | null
          regimen_fiscal?: string | null
          rfc?: string | null
          segmento?: string | null
          serie_fiscal?: string | null
          tipo?: string
        }
        Update: {
          activo?: boolean
          ambiente_pago?: string | null
          company_id?: string
          created_at?: string | null
          descripcion?: string | null
          direccion?: string | null
          establecimiento?: string | null
          estado?: string
          id?: string
          latitud?: number | null
          logo_url?: string | null
          longitud?: number | null
          lugar_expedicion?: string | null
          max_unidades_apartamento?: number | null
          max_unidades_bodega?: number | null
          max_unidades_casa?: number | null
          max_unidades_local_comercial?: number | null
          max_unidades_oficina?: number | null
          max_unidades_otro?: number | null
          max_unidades_parqueadero?: number | null
          moneda?: string
          moneda_condominios?: string | null
          nit?: string | null
          nombre?: string
          nombre_fiscal?: string | null
          proveedor_pago?: string | null
          proveedor_timbrado?: string | null
          regimen_fiscal?: string | null
          rfc?: string | null
          segmento?: string | null
          serie_fiscal?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      propuestas_inversion: {
        Row: {
          categoria: string
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_aprobacion: string | null
          fecha_ejecucion: string | null
          fecha_propuesta: string
          id: string
          monto_estimado: number | null
          notas: string | null
          prioridad: string
          project_id: string
          propuesto_por: string | null
          titulo: string
          votos_contra: number
          votos_favor: number
        }
        Insert: {
          categoria?: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_aprobacion?: string | null
          fecha_ejecucion?: string | null
          fecha_propuesta?: string
          id?: string
          monto_estimado?: number | null
          notas?: string | null
          prioridad?: string
          project_id: string
          propuesto_por?: string | null
          titulo: string
          votos_contra?: number
          votos_favor?: number
        }
        Update: {
          categoria?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_aprobacion?: string | null
          fecha_ejecucion?: string | null
          fecha_propuesta?: string
          id?: string
          monto_estimado?: number | null
          notas?: string | null
          prioridad?: string
          project_id?: string
          propuesto_por?: string | null
          titulo?: string
          votos_contra?: number
          votos_favor?: number
        }
        Relationships: [
          {
            foreignKeyName: "propuestas_inversion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propuestas_inversion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "propuestas_inversion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "propuestas_inversion_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores: {
        Row: {
          activo: boolean
          categoria_default: string | null
          company_id: string
          contacto_nombre: string | null
          created_at: string
          dias_credito: number
          direccion: string | null
          email: string | null
          id: string
          nit: string | null
          nombre: string
          notas: string | null
          rfc: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria_default?: string | null
          company_id: string
          contacto_nombre?: string | null
          created_at?: string
          dias_credito?: number
          direccion?: string | null
          email?: string | null
          id?: string
          nit?: string | null
          nombre: string
          notas?: string | null
          rfc?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria_default?: string | null
          company_id?: string
          contacto_nombre?: string | null
          created_at?: string
          dias_credito?: number
          direccion?: string | null
          email?: string | null
          id?: string
          nit?: string | null
          nombre?: string
          notas?: string | null
          rfc?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      proveedores_energia: {
        Row: {
          activo: boolean
          company_id: string
          contacto: string | null
          created_at: string | null
          id: string
          nit: string | null
          nombre: string
          project_id: string
          tipo: string
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          company_id: string
          contacto?: string | null
          created_at?: string | null
          id?: string
          nit?: string | null
          nombre: string
          project_id: string
          tipo: string
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          company_id?: string
          contacto?: string | null
          created_at?: string | null
          id?: string
          nit?: string | null
          nombre?: string
          project_id?: string
          tipo?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "proveedores_energia_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      proyectos_condominio: {
        Row: {
          categoria: string
          company_id: string
          costo_real: number | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha_fin_estimada: string | null
          fecha_fin_real: string | null
          fecha_inicio: string | null
          id: string
          nombre: string
          notas: string | null
          porcentaje_avance: number
          presupuesto: number | null
          project_id: string
          responsable: string | null
        }
        Insert: {
          categoria?: string
          company_id: string
          costo_real?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_fin_estimada?: string | null
          fecha_fin_real?: string | null
          fecha_inicio?: string | null
          id?: string
          nombre: string
          notas?: string | null
          porcentaje_avance?: number
          presupuesto?: number | null
          project_id: string
          responsable?: string | null
        }
        Update: {
          categoria?: string
          company_id?: string
          costo_real?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_fin_estimada?: string | null
          fecha_fin_real?: string | null
          fecha_inicio?: string | null
          id?: string
          nombre?: string
          notas?: string | null
          porcentaje_avance?: number
          presupuesto?: number | null
          project_id?: string
          responsable?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proyectos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proyectos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "proyectos_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_asamblea: {
        Row: {
          asamblea_id: string
          created_at: string
          descripcion: string | null
          id: string
          orden: number
          resultado: string | null
          tipo: string
          titulo: string
        }
        Insert: {
          asamblea_id: string
          created_at?: string
          descripcion?: string | null
          id?: string
          orden?: number
          resultado?: string | null
          tipo?: string
          titulo: string
        }
        Update: {
          asamblea_id?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          orden?: number
          resultado?: string | null
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "puntos_asamblea_asamblea_id_fkey"
            columns: ["asamblea_id"]
            isOneToOne: false
            referencedRelation: "asambleas"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_control_ruta: {
        Row: {
          area_id: string
          created_at: string
          id: string
          instrucciones: string | null
          orden: number
          ruta_id: string
          tiempo_estimado_min: number | null
        }
        Insert: {
          area_id: string
          created_at?: string
          id?: string
          instrucciones?: string | null
          orden?: number
          ruta_id: string
          tiempo_estimado_min?: number | null
        }
        Update: {
          area_id?: string
          created_at?: string
          id?: string
          instrucciones?: string | null
          orden?: number
          ruta_id?: string
          tiempo_estimado_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "puntos_control_ruta_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_control_ruta_ruta_id_fkey"
            columns: ["ruta_id"]
            isOneToOne: false
            referencedRelation: "rutas_ronda"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_log: {
        Row: {
          action: string
          at: string
          id: number
          subject: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          at?: string
          id?: number
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          at?: string
          id?: number
          subject?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      recargos_mora: {
        Row: {
          anulado_por: string | null
          company_id: string
          created_at: string
          cuota_id: string | null
          estado: string
          fecha_anulacion: string | null
          fecha_aplicacion: string
          id: string
          monto_calculado: number
          motivo: string | null
          project_id: string
          registro_id: string | null
          tipo: string
          unidad_id: string | null
          valor: number
        }
        Insert: {
          anulado_por?: string | null
          company_id: string
          created_at?: string
          cuota_id?: string | null
          estado?: string
          fecha_anulacion?: string | null
          fecha_aplicacion?: string
          id?: string
          monto_calculado: number
          motivo?: string | null
          project_id: string
          registro_id?: string | null
          tipo?: string
          unidad_id?: string | null
          valor: number
        }
        Update: {
          anulado_por?: string | null
          company_id?: string
          created_at?: string
          cuota_id?: string | null
          estado?: string
          fecha_anulacion?: string | null
          fecha_aplicacion?: string
          id?: string
          monto_calculado?: number
          motivo?: string | null
          project_id?: string
          registro_id?: string | null
          tipo?: string
          unidad_id?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "recargos_mora_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recargos_mora_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recargos_mora_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "recargos_mora_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recargos_mora_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recargos_mora_registro_id_fkey"
            columns: ["registro_id"]
            isOneToOne: false
            referencedRelation: "registros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recargos_mora_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      recibos_digitales: {
        Row: {
          company_id: string
          concepto: string
          created_at: string
          cuota_id: string | null
          destinatario_email: string | null
          destinatario_nombre: string | null
          enviado_por: string | null
          estado: string
          fecha_emision: string
          id: string
          monto: number
          notas: string | null
          numero_recibo: string
          project_id: string
          unidad_id: string
        }
        Insert: {
          company_id: string
          concepto: string
          created_at?: string
          cuota_id?: string | null
          destinatario_email?: string | null
          destinatario_nombre?: string | null
          enviado_por?: string | null
          estado?: string
          fecha_emision?: string
          id?: string
          monto: number
          notas?: string | null
          numero_recibo: string
          project_id: string
          unidad_id: string
        }
        Update: {
          company_id?: string
          concepto?: string
          created_at?: string
          cuota_id?: string | null
          destinatario_email?: string | null
          destinatario_nombre?: string | null
          enviado_por?: string | null
          estado?: string
          fecha_emision?: string
          id?: string
          monto?: number
          notas?: string | null
          numero_recibo?: string
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recibos_digitales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_digitales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_digitales_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "recibos_digitales_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_digitales_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_digitales_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      reclamos_condominio: {
        Row: {
          anonimo: boolean
          asunto: string
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_respuesta: string | null
          id: string
          plazo_respuesta: string | null
          prioridad: string
          project_id: string
          respondido_por: string | null
          respuesta_admin: string | null
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          anonimo?: boolean
          asunto: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_respuesta?: string | null
          id?: string
          plazo_respuesta?: string | null
          prioridad?: string
          project_id: string
          respondido_por?: string | null
          respuesta_admin?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          anonimo?: boolean
          asunto?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_respuesta?: string | null
          id?: string
          plazo_respuesta?: string | null
          prioridad?: string
          project_id?: string
          respondido_por?: string | null
          respuesta_admin?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reclamos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclamos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclamos_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "reclamos_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reclamos_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      recordatorios_condominio: {
        Row: {
          asignado_a: string | null
          asignado_nombre: string | null
          company_id: string
          completado: boolean
          created_at: string
          created_by: string | null
          descripcion: string | null
          entidad_id: string | null
          fecha_completado: string | null
          fecha_limite: string
          id: string
          prioridad: string
          project_id: string
          tipo_entidad: string | null
          titulo: string
        }
        Insert: {
          asignado_a?: string | null
          asignado_nombre?: string | null
          company_id: string
          completado?: boolean
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          entidad_id?: string | null
          fecha_completado?: string | null
          fecha_limite: string
          id?: string
          prioridad?: string
          project_id: string
          tipo_entidad?: string | null
          titulo: string
        }
        Update: {
          asignado_a?: string | null
          asignado_nombre?: string | null
          company_id?: string
          completado?: boolean
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          entidad_id?: string | null
          fecha_completado?: string | null
          fecha_limite?: string
          id?: string
          prioridad?: string
          project_id?: string
          tipo_entidad?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "recordatorios_condominio_asignado_a_fkey"
            columns: ["asignado_a"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "recordatorios_condominio_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      registro_asistentes_evento: {
        Row: {
          asistio: boolean | null
          company_id: string
          confirmado: boolean
          created_at: string
          evento_id: string
          id: string
          nombre: string
          num_personas: number
          unidad_id: string
        }
        Insert: {
          asistio?: boolean | null
          company_id: string
          confirmado?: boolean
          created_at?: string
          evento_id: string
          id?: string
          nombre: string
          num_personas?: number
          unidad_id: string
        }
        Update: {
          asistio?: boolean | null
          company_id?: string
          confirmado?: boolean
          created_at?: string
          evento_id?: string
          id?: string
          nombre?: string
          num_personas?: number
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "registro_asistentes_evento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_asistentes_evento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_asistentes_evento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "registro_asistentes_evento_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "eventos_comunidad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_asistentes_evento_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      registro_autoridades: {
        Row: {
          company_id: string
          created_at: string
          documento_referencia: string | null
          fecha: string
          fecha_seguimiento: string | null
          hora_llegada: string | null
          hora_salida: string | null
          id: string
          motivo: string
          nombre_funcionario: string | null
          nombre_institucion: string | null
          observaciones: string | null
          project_id: string
          requiere_seguimiento: boolean
          resultado: string | null
          tipo_autoridad: string
        }
        Insert: {
          company_id: string
          created_at?: string
          documento_referencia?: string | null
          fecha?: string
          fecha_seguimiento?: string | null
          hora_llegada?: string | null
          hora_salida?: string | null
          id?: string
          motivo: string
          nombre_funcionario?: string | null
          nombre_institucion?: string | null
          observaciones?: string | null
          project_id: string
          requiere_seguimiento?: boolean
          resultado?: string | null
          tipo_autoridad?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          documento_referencia?: string | null
          fecha?: string
          fecha_seguimiento?: string | null
          hora_llegada?: string | null
          hora_salida?: string | null
          id?: string
          motivo?: string
          nombre_funcionario?: string | null
          nombre_institucion?: string | null
          observaciones?: string | null
          project_id?: string
          requiere_seguimiento?: boolean
          resultado?: string | null
          tipo_autoridad?: string
        }
        Relationships: [
          {
            foreignKeyName: "registro_autoridades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_autoridades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registro_autoridades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "registro_autoridades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      registros: {
        Row: {
          anulada_at: string | null
          canon_aplicado: number | null
          cliente_id: string | null
          cliente_nombre: string | null
          consumo: number | null
          contador_id: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          dias_servicio: number | null
          emitida_at: string | null
          estado: string | null
          factura_estado: string | null
          fecha: string
          fecha_lectura_anterior: string | null
          fecha_pago: string | null
          fecha_vencimiento: string | null
          foto: string | null
          gps: Json | null
          id: string
          iva_monto: number | null
          iva_tasa: number | null
          lectura_actual: number | null
          lectura_anterior: number | null
          mes: string | null
          monto_calculado: number | null
          monto_con_iva: number | null
          monto_pagado: number | null
          mora_aplicada_at: string | null
          mora_monto: number | null
          notas: string | null
          pagada_at: string | null
          project_id: string | null
          regla_mora_id: string | null
          tarifa_aplicada: number | null
          tarifa_exceso_aplicada: number | null
          tipo_cobro: string | null
          total_a_pagar: number | null
          vencida_at: string | null
        }
        Insert: {
          anulada_at?: string | null
          canon_aplicado?: number | null
          cliente_id?: string | null
          cliente_nombre?: string | null
          consumo?: number | null
          contador_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          dias_servicio?: number | null
          emitida_at?: string | null
          estado?: string | null
          factura_estado?: string | null
          fecha: string
          fecha_lectura_anterior?: string | null
          fecha_pago?: string | null
          fecha_vencimiento?: string | null
          foto?: string | null
          gps?: Json | null
          id?: string
          iva_monto?: number | null
          iva_tasa?: number | null
          lectura_actual?: number | null
          lectura_anterior?: number | null
          mes?: string | null
          monto_calculado?: number | null
          monto_con_iva?: number | null
          monto_pagado?: number | null
          mora_aplicada_at?: string | null
          mora_monto?: number | null
          notas?: string | null
          pagada_at?: string | null
          project_id?: string | null
          regla_mora_id?: string | null
          tarifa_aplicada?: number | null
          tarifa_exceso_aplicada?: number | null
          tipo_cobro?: string | null
          total_a_pagar?: number | null
          vencida_at?: string | null
        }
        Update: {
          anulada_at?: string | null
          canon_aplicado?: number | null
          cliente_id?: string | null
          cliente_nombre?: string | null
          consumo?: number | null
          contador_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          dias_servicio?: number | null
          emitida_at?: string | null
          estado?: string | null
          factura_estado?: string | null
          fecha?: string
          fecha_lectura_anterior?: string | null
          fecha_pago?: string | null
          fecha_vencimiento?: string | null
          foto?: string | null
          gps?: Json | null
          id?: string
          iva_monto?: number | null
          iva_tasa?: number | null
          lectura_actual?: number | null
          lectura_anterior?: number | null
          mes?: string | null
          monto_calculado?: number | null
          monto_con_iva?: number | null
          monto_pagado?: number | null
          mora_aplicada_at?: string | null
          mora_monto?: number | null
          notas?: string | null
          pagada_at?: string | null
          project_id?: string | null
          regla_mora_id?: string | null
          tarifa_aplicada?: number | null
          tarifa_exceso_aplicada?: number | null
          tipo_cobro?: string | null
          total_a_pagar?: number | null
          vencida_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registros_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_contador_id_fkey"
            columns: ["contador_id"]
            isOneToOne: false
            referencedRelation: "contadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_regla_mora_id_fkey"
            columns: ["regla_mora_id"]
            isOneToOne: false
            referencedRelation: "reglas_mora_config"
            referencedColumns: ["id"]
          },
        ]
      }
      registros_calidad: {
        Row: {
          company_id: string | null
          created_at: string | null
          created_by: string | null
          cumple_total: boolean
          cumplimiento: Json
          fecha: string
          fuente_id: string | null
          id: string
          observaciones: string | null
          parametros: Json
          reporte_base64: string | null
          reporte_nombre: string | null
          reporte_path: string | null
          reporte_tipo: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cumple_total?: boolean
          cumplimiento?: Json
          fecha?: string
          fuente_id?: string | null
          id?: string
          observaciones?: string | null
          parametros?: Json
          reporte_base64?: string | null
          reporte_nombre?: string | null
          reporte_path?: string | null
          reporte_tipo?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          cumple_total?: boolean
          cumplimiento?: Json
          fecha?: string
          fuente_id?: string | null
          id?: string
          observaciones?: string | null
          parametros?: Json
          reporte_base64?: string | null
          reporte_nombre?: string | null
          reporte_path?: string | null
          reporte_tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registros_calidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_calidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_calidad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "registros_calidad_fuente_id_fkey"
            columns: ["fuente_id"]
            isOneToOne: false
            referencedRelation: "fuentes_agua"
            referencedColumns: ["id"]
          },
        ]
      }
      registros_residuos: {
        Row: {
          cantidad_kg: number | null
          company_id: string
          created_at: string
          descripcion_incidencia: string | null
          empresa_recolectora: string | null
          estado: string
          fecha: string
          id: string
          incidencia: boolean
          notas: string | null
          project_id: string
          punto_acopio: string | null
          registrado_por: string | null
          tipo_residuo: string
        }
        Insert: {
          cantidad_kg?: number | null
          company_id: string
          created_at?: string
          descripcion_incidencia?: string | null
          empresa_recolectora?: string | null
          estado?: string
          fecha?: string
          id?: string
          incidencia?: boolean
          notas?: string | null
          project_id: string
          punto_acopio?: string | null
          registrado_por?: string | null
          tipo_residuo?: string
        }
        Update: {
          cantidad_kg?: number | null
          company_id?: string
          created_at?: string
          descripcion_incidencia?: string | null
          empresa_recolectora?: string | null
          estado?: string
          fecha?: string
          id?: string
          incidencia?: boolean
          notas?: string | null
          project_id?: string
          punto_acopio?: string | null
          registrado_por?: string | null
          tipo_residuo?: string
        }
        Relationships: [
          {
            foreignKeyName: "registros_residuos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_residuos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registros_residuos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "registros_residuos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reglamento_condominio: {
        Row: {
          capitulo: string
          categoria: string
          company_id: string
          contenido: string
          created_at: string
          fecha_vigencia: string | null
          id: string
          notas: string | null
          numero_articulo: string
          project_id: string
          titulo: string
          version: string
          vigente: boolean
        }
        Insert: {
          capitulo: string
          categoria?: string
          company_id: string
          contenido: string
          created_at?: string
          fecha_vigencia?: string | null
          id?: string
          notas?: string | null
          numero_articulo: string
          project_id: string
          titulo: string
          version?: string
          vigente?: boolean
        }
        Update: {
          capitulo?: string
          categoria?: string
          company_id?: string
          contenido?: string
          created_at?: string
          fecha_vigencia?: string | null
          id?: string
          notas?: string | null
          numero_articulo?: string
          project_id?: string
          titulo?: string
          version?: string
          vigente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "reglamento_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglamento_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglamento_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "reglamento_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reglas_mora_config: {
        Row: {
          activa: boolean
          aplicar_sobre: string
          company_id: string
          created_at: string
          dias_vencimiento: number
          id: string
          nombre: string
          notas: string | null
          periodo_gracia: number
          project_id: string
          tipo: string
          valor: number
        }
        Insert: {
          activa?: boolean
          aplicar_sobre?: string
          company_id: string
          created_at?: string
          dias_vencimiento?: number
          id?: string
          nombre: string
          notas?: string | null
          periodo_gracia?: number
          project_id: string
          tipo?: string
          valor: number
        }
        Update: {
          activa?: boolean
          aplicar_sobre?: string
          company_id?: string
          created_at?: string
          dias_vencimiento?: number
          id?: string
          nombre?: string
          notas?: string | null
          periodo_gracia?: number
          project_id?: string
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "reglas_mora_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglas_mora_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglas_mora_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "reglas_mora_config_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reglas_notificacion: {
        Row: {
          activo: boolean
          canal: string
          company_id: string
          created_at: string
          destinatario: string
          dias_anticipacion: number | null
          evento: string
          id: string
          mensaje_template: string | null
          nombre: string
          project_id: string
        }
        Insert: {
          activo?: boolean
          canal?: string
          company_id: string
          created_at?: string
          destinatario?: string
          dias_anticipacion?: number | null
          evento: string
          id?: string
          mensaje_template?: string | null
          nombre: string
          project_id: string
        }
        Update: {
          activo?: boolean
          canal?: string
          company_id?: string
          created_at?: string
          destinatario?: string
          dias_anticipacion?: number | null
          evento?: string
          id?: string
          mensaje_template?: string | null
          nombre?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reglas_notificacion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglas_notificacion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reglas_notificacion_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "reglas_notificacion_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      report_runs: {
        Row: {
          actor_id: string | null
          company_id: string
          error_msg: string | null
          format: string | null
          id: number
          rows_count: number | null
          status: string
          template_id: string
          triggered_at: string
          triggered_by: string
        }
        Insert: {
          actor_id?: string | null
          company_id: string
          error_msg?: string | null
          format?: string | null
          id?: number
          rows_count?: number | null
          status?: string
          template_id: string
          triggered_at?: string
          triggered_by: string
        }
        Update: {
          actor_id?: string | null
          company_id?: string
          error_msg?: string | null
          format?: string | null
          id?: number
          rows_count?: number | null
          status?: string
          template_id?: string
          triggered_at?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          default_format: string
          description: string | null
          filters: Json
          id: string
          last_run_at: string | null
          name: string
          project_id: string | null
          recipients: Json
          schedule_kind: string
          source_table: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          default_format?: string
          description?: string | null
          filters?: Json
          id?: string
          last_run_at?: string | null
          name: string
          project_id?: string | null
          recipients?: Json
          schedule_kind?: string
          source_table: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          default_format?: string
          description?: string | null
          filters?: Json
          id?: string
          last_run_at?: string | null
          name?: string
          project_id?: string | null
          recipients?: Json
          schedule_kind?: string
          source_table?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "report_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_amenidades: {
        Row: {
          amenidad_id: string
          aprobada_at: string | null
          aprobada_por: string | null
          checkin_at: string | null
          checkin_foto_url: string | null
          checkin_por: string | null
          checkout_at: string | null
          checkout_foto_url: string | null
          checkout_por: string | null
          cliente_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          cuota_id: string | null
          cuota_retencion_id: string | null
          deposito_devuelto_at: string | null
          deposito_estado: string
          deposito_pagado: boolean
          deposito_retenido_monto: number | null
          deposito_retenido_motivo: string | null
          estado: string
          fecha: string
          hora_fin: string
          hora_inicio: string
          id: string
          metodo_pago_tarifa: string | null
          monto_tarifa: number | null
          no_show: boolean
          notas: string | null
          num_invitados: number
          observaciones_uso: string | null
          rechazada_motivo: string | null
          recordatorio_enviado: boolean
          recordatorio_enviado_at: string | null
          reglamento_aceptado_at: string | null
          tarifa_pagada: boolean
          unidad_id: string
        }
        Insert: {
          amenidad_id: string
          aprobada_at?: string | null
          aprobada_por?: string | null
          checkin_at?: string | null
          checkin_foto_url?: string | null
          checkin_por?: string | null
          checkout_at?: string | null
          checkout_foto_url?: string | null
          checkout_por?: string | null
          cliente_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          cuota_id?: string | null
          cuota_retencion_id?: string | null
          deposito_devuelto_at?: string | null
          deposito_estado?: string
          deposito_pagado?: boolean
          deposito_retenido_monto?: number | null
          deposito_retenido_motivo?: string | null
          estado?: string
          fecha: string
          hora_fin: string
          hora_inicio: string
          id?: string
          metodo_pago_tarifa?: string | null
          monto_tarifa?: number | null
          no_show?: boolean
          notas?: string | null
          num_invitados?: number
          observaciones_uso?: string | null
          rechazada_motivo?: string | null
          recordatorio_enviado?: boolean
          recordatorio_enviado_at?: string | null
          reglamento_aceptado_at?: string | null
          tarifa_pagada?: boolean
          unidad_id: string
        }
        Update: {
          amenidad_id?: string
          aprobada_at?: string | null
          aprobada_por?: string | null
          checkin_at?: string | null
          checkin_foto_url?: string | null
          checkin_por?: string | null
          checkout_at?: string | null
          checkout_foto_url?: string | null
          checkout_por?: string | null
          cliente_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          cuota_id?: string | null
          cuota_retencion_id?: string | null
          deposito_devuelto_at?: string | null
          deposito_estado?: string
          deposito_pagado?: boolean
          deposito_retenido_monto?: number | null
          deposito_retenido_motivo?: string | null
          estado?: string
          fecha?: string
          hora_fin?: string
          hora_inicio?: string
          id?: string
          metodo_pago_tarifa?: string | null
          monto_tarifa?: number | null
          no_show?: boolean
          notas?: string | null
          num_invitados?: number
          observaciones_uso?: string | null
          rechazada_motivo?: string | null
          recordatorio_enviado?: boolean
          recordatorio_enviado_at?: string | null
          reglamento_aceptado_at?: string | null
          tarifa_pagada?: boolean
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservas_amenidades_amenidad_id_fkey"
            columns: ["amenidad_id"]
            isOneToOne: false
            referencedRelation: "amenidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_amenidades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_amenidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_amenidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_amenidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "reservas_amenidades_cuota_id_fkey"
            columns: ["cuota_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_amenidades_cuota_retencion_id_fkey"
            columns: ["cuota_retencion_id"]
            isOneToOne: false
            referencedRelation: "cuotas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_amenidades_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      reservas_str: {
        Row: {
          codigo_confirmacion: string | null
          company_id: string
          created_at: string
          estado: string
          fecha_entrada: string
          fecha_reservacion: string | null
          fecha_salida: string
          foto_documento_url: string | null
          foto_url: string | null
          hora_llegada_estimada: string | null
          hora_salida_estimada: string | null
          huesped_email: string | null
          huesped_nombre: string
          huesped_telefono: string | null
          id: string
          mascotas: boolean
          monto_noche: number | null
          monto_total: number | null
          notas: string | null
          num_adultos: number
          num_bebes: number
          num_ninos: number
          plataforma: string
          politica_cancelacion: string | null
          project_id: string
          unidad_id: string | null
        }
        Insert: {
          codigo_confirmacion?: string | null
          company_id: string
          created_at?: string
          estado?: string
          fecha_entrada: string
          fecha_reservacion?: string | null
          fecha_salida: string
          foto_documento_url?: string | null
          foto_url?: string | null
          hora_llegada_estimada?: string | null
          hora_salida_estimada?: string | null
          huesped_email?: string | null
          huesped_nombre: string
          huesped_telefono?: string | null
          id?: string
          mascotas?: boolean
          monto_noche?: number | null
          monto_total?: number | null
          notas?: string | null
          num_adultos?: number
          num_bebes?: number
          num_ninos?: number
          plataforma?: string
          politica_cancelacion?: string | null
          project_id: string
          unidad_id?: string | null
        }
        Update: {
          codigo_confirmacion?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha_entrada?: string
          fecha_reservacion?: string | null
          fecha_salida?: string
          foto_documento_url?: string | null
          foto_url?: string | null
          hora_llegada_estimada?: string | null
          hora_salida_estimada?: string | null
          huesped_email?: string | null
          huesped_nombre?: string
          huesped_telefono?: string | null
          id?: string
          mascotas?: boolean
          monto_noche?: number | null
          monto_total?: number | null
          notas?: string | null
          num_adultos?: number
          num_bebes?: number
          num_ninos?: number
          plataforma?: string
          politica_cancelacion?: string | null
          project_id?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservas_str_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_str_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_str_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "reservas_str_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservas_str_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      respuestas_encuesta: {
        Row: {
          company_id: string
          created_at: string
          encuesta_id: string
          id: string
          nombre_respondente: string | null
          project_id: string
          respuestas: Json
          unidad_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          encuesta_id: string
          id?: string
          nombre_respondente?: string | null
          project_id: string
          respuestas?: Json
          unidad_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          encuesta_id?: string
          id?: string
          nombre_respondente?: string | null
          project_id?: string
          respuestas?: Json
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "respuestas_encuesta_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respuestas_encuesta_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respuestas_encuesta_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "respuestas_encuesta_encuesta_id_fkey"
            columns: ["encuesta_id"]
            isOneToOne: false
            referencedRelation: "encuestas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respuestas_encuesta_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respuestas_encuesta_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      revisiones_tarea: {
        Row: {
          bloque_id: string
          comentario: string | null
          created_at: string | null
          estado: string
          id: string
          revisado_en: string | null
          revisado_por: string | null
          tarea_id: string
        }
        Insert: {
          bloque_id: string
          comentario?: string | null
          created_at?: string | null
          estado?: string
          id?: string
          revisado_en?: string | null
          revisado_por?: string | null
          tarea_id: string
        }
        Update: {
          bloque_id?: string
          comentario?: string | null
          created_at?: string | null
          estado?: string
          id?: string
          revisado_en?: string | null
          revisado_por?: string | null
          tarea_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revisiones_tarea_bloque_id_fkey"
            columns: ["bloque_id"]
            isOneToOne: false
            referencedRelation: "bloques_turno"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revisiones_tarea_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revisiones_tarea_tarea_id_fkey"
            columns: ["tarea_id"]
            isOneToOne: false
            referencedRelation: "tareas_bloque"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          effect: string
          permission_key: string
          role_id: string
        }
        Insert: {
          created_at?: string
          effect?: string
          permission_key: string
          role_id: string
        }
        Update: {
          created_at?: string
          effect?: string
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          cloned_from_role_id: string | null
          color: string | null
          company_id: string | null
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          service: string | null
          updated_at: string
          user_override_for: string | null
        }
        Insert: {
          cloned_from_role_id?: string | null
          color?: string | null
          company_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          service?: string | null
          updated_at?: string
          user_override_for?: string | null
        }
        Update: {
          cloned_from_role_id?: string | null
          color?: string | null
          company_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          service?: string | null
          updated_at?: string
          user_override_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_cloned_from_role_id_fkey"
            columns: ["cloned_from_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "roles_user_override_for_fkey"
            columns: ["user_override_for"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rondas_seguridad: {
        Row: {
          company_id: string
          created_at: string
          estado: string
          fin: string | null
          guardia_id: string | null
          id: string
          inicio: string
          notas: string | null
          project_id: string
          ruta_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          estado?: string
          fin?: string | null
          guardia_id?: string | null
          id?: string
          inicio?: string
          notas?: string | null
          project_id: string
          ruta_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          estado?: string
          fin?: string | null
          guardia_id?: string | null
          id?: string
          inicio?: string
          notas?: string | null
          project_id?: string
          ruta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rondas_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rondas_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rondas_seguridad_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "rondas_seguridad_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rondas_seguridad_ruta_id_fkey"
            columns: ["ruta_id"]
            isOneToOne: false
            referencedRelation: "rutas_ronda"
            referencedColumns: ["id"]
          },
        ]
      }
      ruta_ocurrencias: {
        Row: {
          company_id: string | null
          completada_at: string | null
          created_at: string
          estado: string
          fecha: string
          hora: string | null
          id: string
          project_id: string | null
          recordatorio_enviado: boolean
          recordatorio_enviado_at: string | null
          ruta_id: string
        }
        Insert: {
          company_id?: string | null
          completada_at?: string | null
          created_at?: string
          estado?: string
          fecha: string
          hora?: string | null
          id?: string
          project_id?: string | null
          recordatorio_enviado?: boolean
          recordatorio_enviado_at?: string | null
          ruta_id: string
        }
        Update: {
          company_id?: string | null
          completada_at?: string | null
          created_at?: string
          estado?: string
          fecha?: string
          hora?: string | null
          id?: string
          project_id?: string | null
          recordatorio_enviado?: boolean
          recordatorio_enviado_at?: string | null
          ruta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ruta_ocurrencias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruta_ocurrencias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruta_ocurrencias_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "ruta_ocurrencias_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruta_ocurrencias_ruta_id_fkey"
            columns: ["ruta_id"]
            isOneToOne: false
            referencedRelation: "rutas"
            referencedColumns: ["id"]
          },
        ]
      }
      rutas: {
        Row: {
          asignado_a: string | null
          asignado_email: string | null
          asignado_nombre: string | null
          asignado_telefono: string | null
          cliente_ids: Json
          company_id: string | null
          completada: boolean
          contador_ids: Json
          created_at: string
          descripcion: string | null
          dia_mes: number | null
          dias_semana: Json
          fecha_fin: string | null
          fecha_inicio: string | null
          fecha_programada: string | null
          fechas_especificas: Json
          frecuencia: string
          hora_programada: string | null
          id: string
          intervalo_dias: number | null
          nombre: string
          project_id: string | null
          recordatorio_anticipacion_min: number
          recordatorio_canales: Json
          recurrencia_activa: boolean
          tipo_ruta: string
          unidad_ids: Json
        }
        Insert: {
          asignado_a?: string | null
          asignado_email?: string | null
          asignado_nombre?: string | null
          asignado_telefono?: string | null
          cliente_ids?: Json
          company_id?: string | null
          completada?: boolean
          contador_ids?: Json
          created_at?: string
          descripcion?: string | null
          dia_mes?: number | null
          dias_semana?: Json
          fecha_fin?: string | null
          fecha_inicio?: string | null
          fecha_programada?: string | null
          fechas_especificas?: Json
          frecuencia?: string
          hora_programada?: string | null
          id?: string
          intervalo_dias?: number | null
          nombre: string
          project_id?: string | null
          recordatorio_anticipacion_min?: number
          recordatorio_canales?: Json
          recurrencia_activa?: boolean
          tipo_ruta?: string
          unidad_ids?: Json
        }
        Update: {
          asignado_a?: string | null
          asignado_email?: string | null
          asignado_nombre?: string | null
          asignado_telefono?: string | null
          cliente_ids?: Json
          company_id?: string | null
          completada?: boolean
          contador_ids?: Json
          created_at?: string
          descripcion?: string | null
          dia_mes?: number | null
          dias_semana?: Json
          fecha_fin?: string | null
          fecha_inicio?: string | null
          fecha_programada?: string | null
          fechas_especificas?: Json
          frecuencia?: string
          hora_programada?: string | null
          id?: string
          intervalo_dias?: number | null
          nombre?: string
          project_id?: string | null
          recordatorio_anticipacion_min?: number
          recordatorio_canales?: Json
          recurrencia_activa?: boolean
          tipo_ruta?: string
          unidad_ids?: Json
        }
        Relationships: [
          {
            foreignKeyName: "rutas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rutas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rutas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "rutas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rutas_ronda: {
        Row: {
          company_id: string
          created_at: string
          descripcion: string | null
          id: string
          nombre: string
          project_id: string
          tiempo_estimado_min: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre: string
          project_id: string
          tiempo_estimado_min?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          nombre?: string
          project_id?: string
          tiempo_estimado_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rutas_ronda_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sanciones_condominio: {
        Row: {
          company_id: string
          concepto: string
          created_at: string
          estado: string
          fecha_emision: string
          fecha_vencimiento: string | null
          id: string
          infraccion_id: string | null
          monto: number
          observaciones: string | null
          project_id: string
          unidad_id: string
        }
        Insert: {
          company_id: string
          concepto: string
          created_at?: string
          estado?: string
          fecha_emision?: string
          fecha_vencimiento?: string | null
          id?: string
          infraccion_id?: string | null
          monto?: number
          observaciones?: string | null
          project_id: string
          unidad_id: string
        }
        Update: {
          company_id?: string
          concepto?: string
          created_at?: string
          estado?: string
          fecha_emision?: string
          fecha_vencimiento?: string | null
          id?: string
          infraccion_id?: string | null
          monto?: number
          observaciones?: string | null
          project_id?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sanciones_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sanciones_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sanciones_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "sanciones_condominio_infraccion_id_fkey"
            columns: ["infraccion_id"]
            isOneToOne: false
            referencedRelation: "infracciones_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sanciones_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sanciones_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      security_logs: {
        Row: {
          details: Json | null
          event_type: string
          id: string
          ip_address: string | null
          timestamp: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      seguimiento_acuerdos: {
        Row: {
          acta_id: string | null
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_limite: string | null
          id: string
          notas_seguimiento: string | null
          project_id: string
          responsable: string | null
          titulo: string
        }
        Insert: {
          acta_id?: string | null
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_limite?: string | null
          id?: string
          notas_seguimiento?: string | null
          project_id: string
          responsable?: string | null
          titulo: string
        }
        Update: {
          acta_id?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_limite?: string | null
          id?: string
          notas_seguimiento?: string | null
          project_id?: string
          responsable?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "seguimiento_acuerdos_acta_id_fkey"
            columns: ["acta_id"]
            isOneToOne: false
            referencedRelation: "actas_reunion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seguimiento_acuerdos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seguimiento_acuerdos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seguimiento_acuerdos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "seguimiento_acuerdos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios_housekeeping: {
        Row: {
          company_id: string
          costo: number | null
          created_at: string
          estado: string
          fecha: string
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          notas: string | null
          project_id: string
          responsable: string | null
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          company_id: string
          costo?: number | null
          created_at?: string
          estado?: string
          fecha: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          notas?: string | null
          project_id: string
          responsable?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          company_id?: string
          costo?: number | null
          created_at?: string
          estado?: string
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          notas?: string | null
          project_id?: string
          responsable?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "servicios_housekeeping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_housekeeping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_housekeeping_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "servicios_housekeeping_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_housekeeping_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitud_mudanza_unidad: {
        Row: {
          aprobado_por: string | null
          ascensor_reservado: boolean
          cliente_id: string | null
          comentario_admin: string | null
          company_id: string
          created_at: string
          deposito_pagado: boolean
          deposito_requerido: boolean
          descripcion: string | null
          empresa_mudanza: string | null
          estado: string
          fecha_autorizada: string | null
          fecha_resolucion: string | null
          fecha_solicitada: string | null
          hora_autorizada: string | null
          hora_fin: string | null
          hora_solicitada: string | null
          id: string
          imagenes: string[] | null
          monto_deposito: number | null
          notas: string | null
          project_id: string
          telefono: string | null
          tipo_mudanza: string
          unidad_id: string
        }
        Insert: {
          aprobado_por?: string | null
          ascensor_reservado?: boolean
          cliente_id?: string | null
          comentario_admin?: string | null
          company_id: string
          created_at?: string
          deposito_pagado?: boolean
          deposito_requerido?: boolean
          descripcion?: string | null
          empresa_mudanza?: string | null
          estado?: string
          fecha_autorizada?: string | null
          fecha_resolucion?: string | null
          fecha_solicitada?: string | null
          hora_autorizada?: string | null
          hora_fin?: string | null
          hora_solicitada?: string | null
          id?: string
          imagenes?: string[] | null
          monto_deposito?: number | null
          notas?: string | null
          project_id: string
          telefono?: string | null
          tipo_mudanza: string
          unidad_id: string
        }
        Update: {
          aprobado_por?: string | null
          ascensor_reservado?: boolean
          cliente_id?: string | null
          comentario_admin?: string | null
          company_id?: string
          created_at?: string
          deposito_pagado?: boolean
          deposito_requerido?: boolean
          descripcion?: string | null
          empresa_mudanza?: string | null
          estado?: string
          fecha_autorizada?: string | null
          fecha_resolucion?: string | null
          fecha_solicitada?: string | null
          hora_autorizada?: string | null
          hora_fin?: string | null
          hora_solicitada?: string | null
          id?: string
          imagenes?: string[] | null
          monto_deposito?: number | null
          notas?: string | null
          project_id?: string
          telefono?: string | null
          tipo_mudanza?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitud_mudanza_unidad_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitud_renta_unidad: {
        Row: {
          aprobado_por: string | null
          cliente_id: string | null
          comentario_admin: string | null
          company_id: string
          created_at: string
          estado: string
          fecha_resolucion: string | null
          id: string
          motivo: string | null
          project_id: string
          tipo_aprobado: string | null
          tipo_renta: string
          unidad_id: string
        }
        Insert: {
          aprobado_por?: string | null
          cliente_id?: string | null
          comentario_admin?: string | null
          company_id: string
          created_at?: string
          estado?: string
          fecha_resolucion?: string | null
          id?: string
          motivo?: string | null
          project_id: string
          tipo_aprobado?: string | null
          tipo_renta?: string
          unidad_id: string
        }
        Update: {
          aprobado_por?: string | null
          cliente_id?: string | null
          comentario_admin?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha_resolucion?: string | null
          id?: string
          motivo?: string | null
          project_id?: string
          tipo_aprobado?: string | null
          tipo_renta?: string
          unidad_id?: string
        }
        Relationships: []
      }
      solicitudes_certificado: {
        Row: {
          aprobado_por: string | null
          company_id: string
          created_at: string
          estado: string
          fecha_aprobacion: string | null
          fecha_entrega: string | null
          fecha_solicitud: string
          id: string
          motivo: string | null
          observaciones: string | null
          project_id: string
          solicitante: string
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          aprobado_por?: string | null
          company_id: string
          created_at?: string
          estado?: string
          fecha_aprobacion?: string | null
          fecha_entrega?: string | null
          fecha_solicitud?: string
          id?: string
          motivo?: string | null
          observaciones?: string | null
          project_id: string
          solicitante: string
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          aprobado_por?: string | null
          company_id?: string
          created_at?: string
          estado?: string
          fecha_aprobacion?: string | null
          fecha_entrega?: string | null
          fecha_solicitud?: string
          id?: string
          motivo?: string | null
          observaciones?: string | null
          project_id?: string
          solicitante?: string
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_certificado_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_certificado_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_certificado_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "solicitudes_certificado_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_certificado_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_concierge: {
        Row: {
          atendido_por: string | null
          company_id: string
          costo: number | null
          created_at: string
          descripcion: string
          estado: string
          fecha_solicitud: string
          hora_solicitud: string | null
          id: string
          notas_staff: string | null
          project_id: string
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          atendido_por?: string | null
          company_id: string
          costo?: number | null
          created_at?: string
          descripcion: string
          estado?: string
          fecha_solicitud?: string
          hora_solicitud?: string | null
          id?: string
          notas_staff?: string | null
          project_id: string
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          atendido_por?: string | null
          company_id?: string
          costo?: number | null
          created_at?: string
          descripcion?: string
          estado?: string
          fecha_solicitud?: string
          hora_solicitud?: string | null
          id?: string
          notas_staff?: string | null
          project_id?: string
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_concierge_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_concierge_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_concierge_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "solicitudes_concierge_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_concierge_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_residente: {
        Row: {
          atendido_por: string | null
          company_id: string
          created_at: string
          descripcion: string
          estado: string
          fecha_limite: string | null
          id: string
          prioridad: string
          project_id: string
          respuesta: string | null
          tipo: string
          unidad_id: string | null
        }
        Insert: {
          atendido_por?: string | null
          company_id: string
          created_at?: string
          descripcion: string
          estado?: string
          fecha_limite?: string | null
          id?: string
          prioridad?: string
          project_id: string
          respuesta?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Update: {
          atendido_por?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string
          estado?: string
          fecha_limite?: string | null
          id?: string
          prioridad?: string
          project_id?: string
          respuesta?: string | null
          tipo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_residente_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_residente_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_residente_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "solicitudes_residente_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_residente_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          error_message: string | null
          event_id: string
          event_type: string
          livemode: boolean
          payload: Json
          processed_at: string | null
          received_at: string
        }
        Insert: {
          error_message?: string | null
          event_id: string
          event_type: string
          livemode?: boolean
          payload: Json
          processed_at?: string | null
          received_at?: string
        }
        Update: {
          error_message?: string | null
          event_id?: string
          event_type?: string
          livemode?: boolean
          payload?: Json
          processed_at?: string | null
          received_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_cycle: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          company_id: string
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          past_due_since: string | null
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          company_id: string
          created_at?: string
          current_period_end: string
          current_period_start?: string
          id?: string
          past_due_since?: string | null
          plan_id: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          company_id?: string
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          past_due_since?: string | null
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      sugerencias_condominio: {
        Row: {
          anonima: boolean
          categoria: string
          company_id: string
          created_at: string
          descripcion: string
          estado: string
          fecha_respuesta: string | null
          id: string
          project_id: string
          respondido_por: string | null
          respuesta: string | null
          titulo: string
          unidad_id: string | null
        }
        Insert: {
          anonima?: boolean
          categoria?: string
          company_id: string
          created_at?: string
          descripcion: string
          estado?: string
          fecha_respuesta?: string | null
          id?: string
          project_id: string
          respondido_por?: string | null
          respuesta?: string | null
          titulo: string
          unidad_id?: string | null
        }
        Update: {
          anonima?: boolean
          categoria?: string
          company_id?: string
          created_at?: string
          descripcion?: string
          estado?: string
          fecha_respuesta?: string | null
          id?: string
          project_id?: string
          respondido_por?: string | null
          respuesta?: string | null
          titulo?: string
          unidad_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sugerencias_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sugerencias_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sugerencias_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "sugerencias_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sugerencias_condominio_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      suministros_condominio: {
        Row: {
          activo: boolean
          categoria: string
          company_id: string
          costo_unitario: number | null
          created_at: string
          id: string
          nombre: string
          notas: string | null
          project_id: string
          proveedor: string | null
          stock_actual: number
          stock_minimo: number
          ubicacion: string | null
          unidad_medida: string
        }
        Insert: {
          activo?: boolean
          categoria?: string
          company_id: string
          costo_unitario?: number | null
          created_at?: string
          id?: string
          nombre: string
          notas?: string | null
          project_id: string
          proveedor?: string | null
          stock_actual?: number
          stock_minimo?: number
          ubicacion?: string | null
          unidad_medida?: string
        }
        Update: {
          activo?: boolean
          categoria?: string
          company_id?: string
          costo_unitario?: number | null
          created_at?: string
          id?: string
          nombre?: string
          notas?: string | null
          project_id?: string
          proveedor?: string | null
          stock_actual?: number
          stock_minimo?: number
          ubicacion?: string | null
          unidad_medida?: string
        }
        Relationships: [
          {
            foreignKeyName: "suministros_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suministros_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suministros_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "suministros_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tareas_bloque: {
        Row: {
          area_id: string | null
          bloque_id: string
          completado_en: string | null
          created_at: string
          descripcion: string | null
          estado: string
          foto_url: string | null
          icono: string | null
          id: string
          orden: number | null
          titulo: string
        }
        Insert: {
          area_id?: string | null
          bloque_id: string
          completado_en?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          foto_url?: string | null
          icono?: string | null
          id?: string
          orden?: number | null
          titulo: string
        }
        Update: {
          area_id?: string | null
          bloque_id?: string
          completado_en?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          foto_url?: string | null
          icono?: string | null
          id?: string
          orden?: number | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "tareas_bloque_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas_condominio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_bloque_bloque_id_fkey"
            columns: ["bloque_id"]
            isOneToOne: false
            referencedRelation: "bloques_turno"
            referencedColumns: ["id"]
          },
        ]
      }
      tareas_condominio: {
        Row: {
          area: string | null
          asignado_a: string | null
          categoria: string
          comentarios: Json
          company_id: string
          costo_estimado: number | null
          costo_real: number | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha_cierre: string | null
          fecha_inicio: string | null
          fecha_limite: string | null
          id: string
          notas: string | null
          prioridad: string
          project_id: string
          reportado_por: string | null
          titulo: string
        }
        Insert: {
          area?: string | null
          asignado_a?: string | null
          categoria?: string
          comentarios?: Json
          company_id: string
          costo_estimado?: number | null
          costo_real?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_inicio?: string | null
          fecha_limite?: string | null
          id?: string
          notas?: string | null
          prioridad?: string
          project_id: string
          reportado_por?: string | null
          titulo: string
        }
        Update: {
          area?: string | null
          asignado_a?: string | null
          categoria?: string
          comentarios?: Json
          company_id?: string
          costo_estimado?: number | null
          costo_real?: number | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_inicio?: string | null
          fecha_limite?: string | null
          id?: string
          notas?: string | null
          prioridad?: string
          project_id?: string
          reportado_por?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "tareas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "tareas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifas: {
        Row: {
          activa: boolean
          canon_fijo: number
          company_id: string
          consumo_minimo: number
          created_at: string | null
          descripcion: string | null
          fecha_revision: string | null
          id: string
          nombre: string
          precio_m3: number
          precio_m3_exceso: number
          project_id: string
          tipo_agua: string
          tramos: Json | null
          updated_at: string | null
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          activa?: boolean
          canon_fijo?: number
          company_id: string
          consumo_minimo?: number
          created_at?: string | null
          descripcion?: string | null
          fecha_revision?: string | null
          id?: string
          nombre: string
          precio_m3?: number
          precio_m3_exceso?: number
          project_id: string
          tipo_agua: string
          tramos?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          activa?: boolean
          canon_fijo?: number
          company_id?: string
          consumo_minimo?: number
          created_at?: string | null
          descripcion?: string | null
          fecha_revision?: string | null
          id?: string
          nombre?: string
          precio_m3?: number
          precio_m3_exceso?: number
          project_id?: string
          tipo_agua?: string
          tramos?: Json | null
          updated_at?: string | null
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarifas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "tarifas_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifas_condominio: {
        Row: {
          activo: boolean
          company_id: string
          concepto: string
          created_at: string
          descripcion: string | null
          id: string
          monto: number
          notas: string | null
          periodicidad: string
          project_id: string
          tipo_unidad: string
          vigente_desde: string | null
          vigente_hasta: string | null
        }
        Insert: {
          activo?: boolean
          company_id: string
          concepto: string
          created_at?: string
          descripcion?: string | null
          id?: string
          monto: number
          notas?: string | null
          periodicidad?: string
          project_id: string
          tipo_unidad?: string
          vigente_desde?: string | null
          vigente_hasta?: string | null
        }
        Update: {
          activo?: boolean
          company_id?: string
          concepto?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          monto?: number
          notas?: string | null
          periodicidad?: string
          project_id?: string
          tipo_unidad?: string
          vigente_desde?: string | null
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarifas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_condominio_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "tarifas_condominio_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifas_energia: {
        Row: {
          activa: boolean
          alumbrado_publico: number
          alumbrado_tipo: string
          cargo_fijo: number
          company_id: string
          created_at: string | null
          descripcion: string | null
          id: string
          iva_porcentaje: number
          moneda: string
          nombre: string
          precio_kw_potencia: number
          precio_kwh_energia: number
          precio_kwh_exportado: number
          project_id: string
          proveedor_id: string
          updated_at: string | null
        }
        Insert: {
          activa?: boolean
          alumbrado_publico?: number
          alumbrado_tipo?: string
          cargo_fijo?: number
          company_id: string
          created_at?: string | null
          descripcion?: string | null
          id?: string
          iva_porcentaje?: number
          moneda?: string
          nombre: string
          precio_kw_potencia?: number
          precio_kwh_energia?: number
          precio_kwh_exportado?: number
          project_id: string
          proveedor_id: string
          updated_at?: string | null
        }
        Update: {
          activa?: boolean
          alumbrado_publico?: number
          alumbrado_tipo?: string
          cargo_fijo?: number
          company_id?: string
          created_at?: string | null
          descripcion?: string | null
          id?: string
          iva_porcentaje?: number
          moneda?: string
          nombre?: string
          precio_kw_potencia?: number
          precio_kwh_energia?: number
          precio_kwh_exportado?: number
          project_id?: string
          proveedor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarifas_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_energia_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "tarifas_energia_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifas_energia_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores_energia"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets_mantenimiento: {
        Row: {
          asignado_a: string | null
          cliente_id: string | null
          company_id: string
          costo_estimado: number | null
          costo_real: number | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          descripcion: string | null
          estado: string
          fecha_cierre: string | null
          fecha_limite: string | null
          foto_urls: Json
          id: string
          notas_cierre: string | null
          prioridad: string
          project_id: string
          reportado_por: string | null
          tipo: string
          titulo: string
          unidad_id: string | null
          updated_at: string
        }
        Insert: {
          asignado_a?: string | null
          cliente_id?: string | null
          company_id: string
          costo_estimado?: number | null
          costo_real?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_limite?: string | null
          foto_urls?: Json
          id?: string
          notas_cierre?: string | null
          prioridad?: string
          project_id: string
          reportado_por?: string | null
          tipo?: string
          titulo: string
          unidad_id?: string | null
          updated_at?: string
        }
        Update: {
          asignado_a?: string | null
          cliente_id?: string | null
          company_id?: string
          costo_estimado?: number | null
          costo_real?: number | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_limite?: string | null
          foto_urls?: Json
          id?: string
          notas_cierre?: string | null
          prioridad?: string
          project_id?: string
          reportado_por?: string | null
          tipo?: string
          titulo?: string
          unidad_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_mantenimiento_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_mantenimiento_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "tickets_mantenimiento_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_mantenimiento_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      unidad_residentes: {
        Row: {
          activo: boolean
          cliente_id: string
          company_id: string
          created_at: string
          id: string
          project_id: string
          tipo: string
          unidad_id: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          cliente_id: string
          company_id: string
          created_at?: string
          id?: string
          project_id: string
          tipo?: string
          unidad_id: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          cliente_id?: string
          company_id?: string
          created_at?: string
          id?: string
          project_id?: string
          tipo?: string
          unidad_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unidad_residentes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidad_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidad_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidad_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "unidad_residentes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidad_residentes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      unidades: {
        Row: {
          activo: boolean
          alicuota_pct: number | null
          area_m2: number | null
          cliente_id: string | null
          company_id: string
          contrato_suministro: string | null
          created_at: string
          datos_registrales: string | null
          descripcion: string | null
          direccion: string | null
          estado_ocupacional: string | null
          fecha_construccion: string | null
          fecha_firma_contrato: string | null
          fecha_vencimiento_contrato: string | null
          id: string
          nombre: string
          numero_contrato_suministro: string | null
          piso: number | null
          portal_activo: boolean
          project_id: string
          propietario_email: string | null
          propietario_nombre: string | null
          propietario_telefono: string | null
          tipo: string
          tipo_regimen: string | null
          token_portal: string | null
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          activo?: boolean
          alicuota_pct?: number | null
          area_m2?: number | null
          cliente_id?: string | null
          company_id: string
          contrato_suministro?: string | null
          created_at?: string
          datos_registrales?: string | null
          descripcion?: string | null
          direccion?: string | null
          estado_ocupacional?: string | null
          fecha_construccion?: string | null
          fecha_firma_contrato?: string | null
          fecha_vencimiento_contrato?: string | null
          id?: string
          nombre: string
          numero_contrato_suministro?: string | null
          piso?: number | null
          portal_activo?: boolean
          project_id: string
          propietario_email?: string | null
          propietario_nombre?: string | null
          propietario_telefono?: string | null
          tipo?: string
          tipo_regimen?: string | null
          token_portal?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          activo?: boolean
          alicuota_pct?: number | null
          area_m2?: number | null
          cliente_id?: string | null
          company_id?: string
          contrato_suministro?: string | null
          created_at?: string
          datos_registrales?: string | null
          descripcion?: string | null
          direccion?: string | null
          estado_ocupacional?: string | null
          fecha_construccion?: string | null
          fecha_firma_contrato?: string | null
          fecha_vencimiento_contrato?: string | null
          id?: string
          nombre?: string
          numero_contrato_suministro?: string | null
          piso?: number | null
          portal_activo?: boolean
          project_id?: string
          propietario_email?: string | null
          propietario_nombre?: string | null
          propietario_telefono?: string | null
          tipo?: string
          tipo_regimen?: string | null
          token_portal?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unidades_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unidades_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "unidades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          company_id: string | null
          created_at: string
          cuerpo: string | null
          id: string
          leido: boolean
          leido_at: string | null
          ocurrencia_id: string | null
          paquete_id: string | null
          ruta_id: string | null
          seccion: string | null
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          cuerpo?: string | null
          id?: string
          leido?: boolean
          leido_at?: string | null
          ocurrencia_id?: string | null
          paquete_id?: string | null
          ruta_id?: string | null
          seccion?: string | null
          tipo?: string
          titulo: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          cuerpo?: string | null
          id?: string
          leido?: boolean
          leido_at?: string | null
          ocurrencia_id?: string | null
          paquete_id?: string | null
          ruta_id?: string | null
          seccion?: string | null
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "user_notifications_ocurrencia_id_fkey"
            columns: ["ocurrencia_id"]
            isOneToOne: false
            referencedRelation: "ruta_ocurrencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_paquete_id_fkey"
            columns: ["paquete_id"]
            isOneToOne: false
            referencedRelation: "paquetes_recibidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_ruta_id_fkey"
            columns: ["ruta_id"]
            isOneToOne: false
            referencedRelation: "rutas"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          currency: string
          locale: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          locale?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          locale?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          company_id: string
          last_seen: string
          project_id: string | null
          record_id: string | null
          section: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          last_seen?: string
          project_id?: string | null
          record_id?: string | null
          section?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          last_seen?: string
          project_id?: string | null
          record_id?: string | null
          section?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_presence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_presence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "user_presence_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_project_assignments: {
        Row: {
          created_at: string | null
          id: string
          permission_type: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permission_type?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permission_type?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_project_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          expires_at: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          expires_at?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          expires_at?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          expire: string
          sess: Json
          sid: string
        }
        Insert: {
          expire: string
          sess: Json
          sid: string
        }
        Update: {
          expire?: string
          sess?: Json
          sid?: string
        }
        Relationships: []
      }
      vehiculos_residentes: {
        Row: {
          activo: boolean
          anio: number | null
          color: string | null
          company_id: string
          created_at: string
          id: string
          marca: string | null
          modelo: string | null
          notas: string | null
          placa: string
          project_id: string
          tipo: string
          unidad_id: string
        }
        Insert: {
          activo?: boolean
          anio?: number | null
          color?: string | null
          company_id: string
          created_at?: string
          id?: string
          marca?: string | null
          modelo?: string | null
          notas?: string | null
          placa: string
          project_id: string
          tipo?: string
          unidad_id: string
        }
        Update: {
          activo?: boolean
          anio?: number | null
          color?: string | null
          company_id?: string
          created_at?: string
          id?: string
          marca?: string | null
          modelo?: string | null
          notas?: string | null
          placa?: string
          project_id?: string
          tipo?: string
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehiculos_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehiculos_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehiculos_residentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vehiculos_residentes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehiculos_residentes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      vencimientos_extra: {
        Row: {
          alerta_dias: number
          categoria: string
          company_id: string
          created_at: string
          descripcion: string | null
          entidad: string | null
          fecha_vencimiento: string
          id: string
          monto: number | null
          notas: string | null
          project_id: string
          renovado: boolean
          titulo: string
        }
        Insert: {
          alerta_dias?: number
          categoria?: string
          company_id: string
          created_at?: string
          descripcion?: string | null
          entidad?: string | null
          fecha_vencimiento: string
          id?: string
          monto?: number | null
          notas?: string | null
          project_id: string
          renovado?: boolean
          titulo: string
        }
        Update: {
          alerta_dias?: number
          categoria?: string
          company_id?: string
          created_at?: string
          descripcion?: string | null
          entidad?: string | null
          fecha_vencimiento?: string
          id?: string
          monto?: number | null
          notas?: string | null
          project_id?: string
          renovado?: boolean
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "vencimientos_extra_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_extra_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_extra_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "vencimientos_extra_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      visitantes: {
        Row: {
          company_id: string
          created_at: string
          es_menor: boolean
          fecha_nacimiento: string | null
          foto_documento_url: string | null
          foto_url: string | null
          foto_vehiculo_url: string | null
          hora_entrada: string
          hora_salida: string | null
          id: string
          identificacion: string | null
          motivo: string | null
          nombre: string
          notas: string | null
          placa_vehiculo: string | null
          pre_autorizado_por: string | null
          project_id: string
          qr_token: string | null
          registrado_por: string | null
          reserva_str_id: string | null
          solicitud_mudanza_id: string | null
          unidad_id: string
          valido_hasta: string | null
          visitante_principal_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          es_menor?: boolean
          fecha_nacimiento?: string | null
          foto_documento_url?: string | null
          foto_url?: string | null
          foto_vehiculo_url?: string | null
          hora_entrada?: string
          hora_salida?: string | null
          id?: string
          identificacion?: string | null
          motivo?: string | null
          nombre: string
          notas?: string | null
          placa_vehiculo?: string | null
          pre_autorizado_por?: string | null
          project_id: string
          qr_token?: string | null
          registrado_por?: string | null
          reserva_str_id?: string | null
          solicitud_mudanza_id?: string | null
          unidad_id: string
          valido_hasta?: string | null
          visitante_principal_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          es_menor?: boolean
          fecha_nacimiento?: string | null
          foto_documento_url?: string | null
          foto_url?: string | null
          foto_vehiculo_url?: string | null
          hora_entrada?: string
          hora_salida?: string | null
          id?: string
          identificacion?: string | null
          motivo?: string | null
          nombre?: string
          notas?: string | null
          placa_vehiculo?: string | null
          pre_autorizado_por?: string | null
          project_id?: string
          qr_token?: string | null
          registrado_por?: string | null
          reserva_str_id?: string | null
          solicitud_mudanza_id?: string | null
          unidad_id?: string
          valido_hasta?: string | null
          visitante_principal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitantes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitantes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitantes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "visitantes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitantes_reserva_str_id_fkey"
            columns: ["reserva_str_id"]
            isOneToOne: false
            referencedRelation: "reservas_str"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitantes_solicitud_mudanza_id_fkey"
            columns: ["solicitud_mudanza_id"]
            isOneToOne: false
            referencedRelation: "solicitud_mudanza_unidad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitantes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitantes_visitante_principal_id_fkey"
            columns: ["visitante_principal_id"]
            isOneToOne: false
            referencedRelation: "visitantes"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_control: {
        Row: {
          created_at: string
          estado: string
          id: string
          notas: string | null
          punto_id: string
          ronda_id: string
          visitado_en: string | null
        }
        Insert: {
          created_at?: string
          estado?: string
          id?: string
          notas?: string | null
          punto_id: string
          ronda_id: string
          visitado_en?: string | null
        }
        Update: {
          created_at?: string
          estado?: string
          id?: string
          notas?: string | null
          punto_id?: string
          ronda_id?: string
          visitado_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visitas_control_punto_id_fkey"
            columns: ["punto_id"]
            isOneToOne: false
            referencedRelation: "puntos_control_ruta"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_control_ronda_id_fkey"
            columns: ["ronda_id"]
            isOneToOne: false
            referencedRelation: "rondas_seguridad"
            referencedColumns: ["id"]
          },
        ]
      }
      visitas_frecuentes: {
        Row: {
          activo: boolean
          company_id: string
          created_at: string
          dias_permitidos: string[] | null
          foto_url: string | null
          hora_desde: string | null
          hora_hasta: string | null
          id: string
          identificacion: string | null
          nombre: string
          notas: string | null
          placa_vehiculo: string | null
          project_id: string
          relacion: string
          telefono: string | null
          unidad_id: string
        }
        Insert: {
          activo?: boolean
          company_id: string
          created_at?: string
          dias_permitidos?: string[] | null
          foto_url?: string | null
          hora_desde?: string | null
          hora_hasta?: string | null
          id?: string
          identificacion?: string | null
          nombre: string
          notas?: string | null
          placa_vehiculo?: string | null
          project_id: string
          relacion?: string
          telefono?: string | null
          unidad_id: string
        }
        Update: {
          activo?: boolean
          company_id?: string
          created_at?: string
          dias_permitidos?: string[] | null
          foto_url?: string | null
          hora_desde?: string | null
          hora_hasta?: string | null
          id?: string
          identificacion?: string | null
          nombre?: string
          notas?: string | null
          placa_vehiculo?: string | null
          project_id?: string
          relacion?: string
          telefono?: string | null
          unidad_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitas_frecuentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_frecuentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_frecuentes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "visitas_frecuentes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visitas_frecuentes_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
      votaciones: {
        Row: {
          asamblea_id: string | null
          company_id: string
          created_at: string
          descripcion: string | null
          estado: string
          fecha_cierre: string | null
          fecha_inicio: string
          id: string
          opciones: Json
          project_id: string
          quorum_requerido: number | null
          resultado: string | null
          tipo: string
          titulo: string
          total_unidades: number | null
        }
        Insert: {
          asamblea_id?: string | null
          company_id: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_inicio?: string
          id?: string
          opciones?: Json
          project_id: string
          quorum_requerido?: number | null
          resultado?: string | null
          tipo?: string
          titulo: string
          total_unidades?: number | null
        }
        Update: {
          asamblea_id?: string | null
          company_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_cierre?: string | null
          fecha_inicio?: string
          id?: string
          opciones?: Json
          project_id?: string
          quorum_requerido?: number | null
          resultado?: string | null
          tipo?: string
          titulo?: string
          total_unidades?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "votaciones_asamblea_id_fkey"
            columns: ["asamblea_id"]
            isOneToOne: false
            referencedRelation: "asambleas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votaciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votaciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votaciones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "votaciones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      votos: {
        Row: {
          comentario: string | null
          company_id: string
          created_at: string
          id: string
          opcion_id: string
          registrado_por: string | null
          unidad_id: string
          votacion_id: string
        }
        Insert: {
          comentario?: string | null
          company_id: string
          created_at?: string
          id?: string
          opcion_id: string
          registrado_por?: string | null
          unidad_id: string
          votacion_id: string
        }
        Update: {
          comentario?: string | null
          company_id?: string
          created_at?: string
          id?: string
          opcion_id?: string
          registrado_por?: string | null
          unidad_id?: string
          votacion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "votos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "mv_superadmin_empresa_counts"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "votos_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votos_votacion_id_fkey"
            columns: ["votacion_id"]
            isOneToOne: false
            referencedRelation: "votaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      votos_asamblea: {
        Row: {
          created_at: string
          id: string
          punto_id: string
          registrado_por: string | null
          unidad_id: string
          voto: string
        }
        Insert: {
          created_at?: string
          id?: string
          punto_id: string
          registrado_por?: string | null
          unidad_id: string
          voto: string
        }
        Update: {
          created_at?: string
          id?: string
          punto_id?: string
          registrado_por?: string | null
          unidad_id?: string
          voto?: string
        }
        Relationships: [
          {
            foreignKeyName: "votos_asamblea_punto_id_fkey"
            columns: ["punto_id"]
            isOneToOne: false
            referencedRelation: "puntos_asamblea"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "votos_asamblea_unidad_id_fkey"
            columns: ["unidad_id"]
            isOneToOne: false
            referencedRelation: "unidades"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      companies_safe: {
        Row: {
          activa: boolean | null
          created_at: string | null
          email: string | null
          id: string | null
          logo_url: string | null
          max_projects: number | null
          max_units: number | null
          nit: string | null
          nombre: string | null
          paypal_activo: boolean | null
          paypal_client_id: string | null
          paypal_configured: boolean | null
          stripe_activo: boolean | null
          stripe_configured: boolean | null
          stripe_public_key: string | null
          telefono: string | null
        }
        Insert: {
          activa?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          logo_url?: string | null
          max_projects?: number | null
          max_units?: number | null
          nit?: string | null
          nombre?: string | null
          paypal_activo?: boolean | null
          paypal_client_id?: string | null
          paypal_configured?: boolean | null
          stripe_activo?: boolean | null
          stripe_configured?: boolean | null
          stripe_public_key?: string | null
          telefono?: string | null
        }
        Update: {
          activa?: boolean | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          logo_url?: string | null
          max_projects?: number | null
          max_units?: number | null
          nit?: string | null
          nombre?: string | null
          paypal_activo?: boolean | null
          paypal_client_id?: string | null
          paypal_configured?: boolean | null
          stripe_activo?: boolean | null
          stripe_configured?: boolean | null
          stripe_public_key?: string | null
          telefono?: string | null
        }
        Relationships: []
      }
      mv_superadmin_empresa_counts: {
        Row: {
          company_id: string | null
          monthly_total_cents: number | null
          plan_code: string | null
          project_count: number | null
          subscription_status: string | null
          unit_count: number | null
          user_count: number | null
        }
        Relationships: []
      }
      mv_superadmin_plataforma: {
        Row: {
          canceladas_30d: number | null
          empresas_activas: number | null
          empresas_inactivas: number | null
          mrr_cents: number | null
          plan_distribution: Json | null
          refreshed_at: string | null
          singleton: number | null
          suscripciones_activas: number | null
          suscripciones_trialing: number | null
          suscripciones_vigentes: number | null
          total_empresas: number | null
          total_proyectos: number | null
          total_unidades: number | null
          total_usuarios: number | null
        }
        Relationships: []
      }
      my_feature_flags: {
        Row: {
          current_period_end: string | null
          feature_code: string | null
          plan_code: string | null
          plan_name: string | null
          subscription_status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      agua_cerrar_ciclo: {
        Args: { p_notificar?: boolean; p_periodo: string; p_project_id: string }
        Returns: Json
      }
      aplicar_mora_cuotas_vencidas: { Args: never; Returns: undefined }
      aplicar_mora_facturas_vencidas: { Args: never; Returns: undefined }
      banco_ajuste_conciliacion: {
        Args: { p_descripcion?: string; p_movimiento_id: string }
        Returns: {
          company_id: string
          conciliado_at: string | null
          conciliado_por: string | null
          created_at: string
          cuenta_bancaria_id: string
          descripcion: string | null
          estado: string
          fecha: string
          id: string
          lote_id: string | null
          match_id: string | null
          match_tipo: string | null
          monto: number
          referencia: string | null
        }
        SetofOptions: {
          from: "*"
          to: "banco_movimientos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      banco_conciliar_movimiento: {
        Args: {
          p_match_id: string
          p_match_tipo: string
          p_movimiento_id: string
        }
        Returns: {
          company_id: string
          conciliado_at: string | null
          conciliado_por: string | null
          created_at: string
          cuenta_bancaria_id: string
          descripcion: string | null
          estado: string
          fecha: string
          id: string
          lote_id: string | null
          match_id: string | null
          match_tipo: string | null
          monto: number
          referencia: string | null
        }
        SetofOptions: {
          from: "*"
          to: "banco_movimientos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      banco_desconciliar_movimiento: {
        Args: { p_movimiento_id: string }
        Returns: {
          company_id: string
          conciliado_at: string | null
          conciliado_por: string | null
          created_at: string
          cuenta_bancaria_id: string
          descripcion: string | null
          estado: string
          fecha: string
          id: string
          lote_id: string | null
          match_id: string | null
          match_tipo: string | null
          monto: number
          referencia: string | null
        }
        SetofOptions: {
          from: "*"
          to: "banco_movimientos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      banco_estado_conciliacion: {
        Args: { p_cuenta_bancaria_id: string; p_periodo: string }
        Returns: {
          monto_pendiente: number
          pendientes: number
          saldo_banco: number
          saldo_libro: number
          saldo_libro_origen: number
        }[]
      }
      banco_sugerencias_conciliacion: {
        Args: { p_cuenta_bancaria_id: string }
        Returns: {
          candidato_descripcion: string
          candidato_fecha: string
          candidato_id: string
          candidato_monto: number
          candidato_tipo: string
          confianza: string
          movimiento_id: string
        }[]
      }
      buscar_cliente_para_onboarding: {
        Args: { p_cui_dui: string; p_email: string; p_fecha_nac: string }
        Returns: Json
      }
      calcular_cumplimiento_calidad:
        | { Args: { p_parametros: Json; p_tipo_agua: string }; Returns: Json }
        | {
            Args: {
              p_company_id?: string
              p_parametros: Json
              p_tipo_agua: string
            }
            Returns: Json
          }
      calculate_monthly_total_cents: {
        Args: { p_company_id: string }
        Returns: {
          base_activation_cents: number
          extra_projects_count: number
          extra_projects_subtotal: number
          extra_units_count: number
          extra_units_subtotal: number
          primary_project_id: string
          primary_units_count: number
          primary_units_subtotal: number
          total_cents: number
        }[]
      }
      claim_due_scheduled_reports: {
        Args: { p_schedule_kind: string }
        Returns: {
          company_id: string
          default_format: string
          id: string
          name: string
          source_table: string
        }[]
      }
      claim_notifications_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          attempts: number
          channel: string
          company_id: string
          id: string
          max_attempts: number
          payload: Json
          recipient: string
          template_key: string
        }[]
      }
      company_has_feature: {
        Args: { p_company_id: string; p_feature_code: string }
        Returns: boolean
      }
      company_is_active: { Args: { p_company_id: string }; Returns: boolean }
      company_write_enabled: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      condominios_cerrar_ciclo: {
        Args: { p_notificar?: boolean; p_periodo: string; p_project_id: string }
        Returns: Json
      }
      conta_anio_cerrado: {
        Args: { p_anio: number; p_company_id: string; p_project_id: string }
        Returns: boolean
      }
      conta_anular_asiento: {
        Args: { p_asiento_id: string; p_motivo?: string }
        Returns: {
          anulado_por_id: string | null
          company_id: string
          concepto: string
          created_at: string
          created_by: string | null
          estado: string
          fecha: string
          id: string
          moneda_base: string
          numero: number | null
          origen: string
          origen_evento: string | null
          origen_id: string | null
          origen_tabla: string | null
          periodo: string | null
          project_id: string | null
          publicado_at: string | null
          reversa_de_id: string | null
          tipo: string
          total_debe: number
          total_haber: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "conta_asientos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conta_balance_general: {
        Args: { p_company_id: string; p_periodo: string; p_project_id: string }
        Returns: {
          codigo: string
          cuenta_id: string
          nombre: string
          saldo: number
          tipo: string
        }[]
      }
      conta_balanza_comprobacion: {
        Args: { p_company_id: string; p_periodo: string; p_project_id: string }
        Returns: {
          abonos: number
          cargos: number
          codigo: string
          cuenta_id: string
          moneda: string
          naturaleza: string
          nombre: string
          saldo_final: number
          saldo_final_origen: number
          saldo_inicial: number
          tipo: string
        }[]
      }
      conta_cierre_anual:
        | {
            Args: { p_anio: number }
            Returns: {
              anulado_por_id: string | null
              company_id: string
              concepto: string
              created_at: string
              created_by: string | null
              estado: string
              fecha: string
              id: string
              moneda_base: string
              numero: number | null
              origen: string
              origen_evento: string | null
              origen_id: string | null
              origen_tabla: string | null
              periodo: string | null
              project_id: string | null
              publicado_at: string | null
              reversa_de_id: string | null
              tipo: string
              total_debe: number
              total_haber: number
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "conta_asientos"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { p_anio: number; p_project_id: string }
            Returns: {
              anulado_por_id: string | null
              company_id: string
              concepto: string
              created_at: string
              created_by: string | null
              estado: string
              fecha: string
              id: string
              moneda_base: string
              numero: number | null
              origen: string
              origen_evento: string | null
              origen_id: string | null
              origen_tabla: string | null
              periodo: string | null
              project_id: string | null
              publicado_at: string | null
              reversa_de_id: string | null
              tipo: string
              total_debe: number
              total_haber: number
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "conta_asientos"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      conta_consolidado: {
        Args: { p_company_id: string; p_desde: string; p_hasta: string }
        Returns: {
          activo: number
          activo_origen: number
          capital: number
          capital_origen: number
          gastos: number
          gastos_origen: number
          ingresos: number
          ingresos_origen: number
          ledger_nombre: string
          ledger_project_id: string
          moneda: string
          pasivo: number
          pasivo_origen: number
          resultado: number
          resultado_origen: number
          tasa: number
        }[]
      }
      conta_cuenta_para: {
        Args: { p_company_id: string; p_evento: string; p_project_id: string }
        Returns: string
      }
      conta_estado_resultados: {
        Args: {
          p_company_id: string
          p_desde: string
          p_hasta: string
          p_project_id: string
        }
        Returns: {
          codigo: string
          cuenta_id: string
          monto: number
          nombre: string
          tipo: string
        }[]
      }
      conta_flujo_efectivo: {
        Args: { p_company_id: string; p_periodo: string; p_project_id: string }
        Returns: {
          codigo: string
          cuenta_id: string
          entradas: number
          nombre: string
          saldo_final: number
          saldo_inicial: number
          salidas: number
        }[]
      }
      conta_generar_asiento: {
        Args: {
          p_company_id: string
          p_concepto: string
          p_evento: string
          p_fecha: string
          p_lineas: Json
          p_moneda_doc: string
          p_origen_id: string
          p_origen_tabla: string
          p_project_id: string
          p_tipo: string
        }
        Returns: string
      }
      conta_libro_mayor: {
        Args: { p_cuenta_id: string; p_desde: string; p_hasta: string }
        Returns: {
          asiento_id: string
          concepto: string
          debe: number
          descripcion: string
          fecha: string
          haber: number
          linea_id: string
          numero: number
          saldo: number
        }[]
      }
      conta_moneda_base:
        | { Args: { p_company_id: string }; Returns: string }
        | {
            Args: { p_company_id: string; p_project_id: string }
            Returns: string
          }
      conta_normalizar_moneda: { Args: { p_moneda: string }; Returns: string }
      conta_periodo_cerrado: {
        Args: { p_periodo: string; p_project_id: string }
        Returns: boolean
      }
      conta_publicar_asiento: {
        Args: { p_asiento_id: string }
        Returns: {
          anulado_por_id: string | null
          company_id: string
          concepto: string
          created_at: string
          created_by: string | null
          estado: string
          fecha: string
          id: string
          moneda_base: string
          numero: number | null
          origen: string
          origen_evento: string | null
          origen_id: string | null
          origen_tabla: string | null
          periodo: string | null
          project_id: string | null
          publicado_at: string | null
          reversa_de_id: string | null
          tipo: string
          total_debe: number
          total_haber: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "conta_asientos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conta_revaluar_fx:
        | {
            Args: { p_aplicar?: boolean; p_fecha?: string }
            Returns: {
              ajuste: number
              asiento_id: string
              codigo: string
              cuenta_id: string
              moneda: string
              nombre: string
              resultado: string
              saldo_libro: number
              saldo_origen: number
              saldo_revaluado: number
              tasa: number
            }[]
          }
        | {
            Args: { p_aplicar: boolean; p_fecha: string; p_project_id: string }
            Returns: {
              ajuste: number
              asiento_id: string
              codigo: string
              cuenta_id: string
              moneda: string
              nombre: string
              resultado: string
              saldo_libro: number
              saldo_origen: number
              saldo_revaluado: number
              tasa: number
            }[]
          }
      conta_reversar_automatico: {
        Args: {
          p_company_id: string
          p_concepto: string
          p_evento_original: string
          p_origen_id: string
          p_origen_tabla: string
        }
        Returns: string
      }
      conta_seed_catalogo: {
        Args: { p_company_id: string; p_project_id: string }
        Returns: undefined
      }
      conta_seed_cuenta: {
        Args: {
          p_codigo: string
          p_company: string
          p_detalle: boolean
          p_naturaleza: string
          p_nivel: number
          p_nombre: string
          p_padre_codigo: string
          p_project: string
          p_tipo: string
        }
        Returns: string
      }
      conta_siguiente_folio:
        | { Args: { p_company_id: string }; Returns: number }
        | {
            Args: { p_company_id: string; p_project_id: string }
            Returns: number
          }
      conta_tasa_entre: {
        Args: {
          p_a: string
          p_company_id: string
          p_de: string
          p_fecha: string
        }
        Returns: number
      }
      conta_tasa_vigente: {
        Args: { p_company_id: string; p_fecha: string; p_moneda: string }
        Returns: number
      }
      create_default_conversation_access_rules: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      current_user_role: { Args: never; Returns: string }
      cxp_antiguedad_saldos: {
        Args: { p_company_id: string; p_project_id: string }
        Returns: {
          corriente: number
          d1_30: number
          d31_60: number
          d61_90: number
          d90_mas: number
          proveedor: string
          proveedor_id: string
          total: number
        }[]
      }
      cxp_proyeccion_pagos: {
        Args: { p_company_id: string; p_project_id: string }
        Returns: {
          d0_7: number
          d15_30: number
          d31_mas: number
          d8_14: number
          proveedor: string
          proveedor_id: string
          sin_fecha: number
          total: number
          vencido: number
        }[]
      }
      deactivate_expired_tarifas: { Args: never; Returns: undefined }
      dispatch_scheduled_reports: {
        Args: { p_schedule_kind: string }
        Returns: number
      }
      enqueue_email: {
        Args: {
          p_company_id: string
          p_first_error: string
          p_is_superadmin: boolean
          p_payload: Json
          p_triggered_by: string
        }
        Returns: number
      }
      enqueue_notification: {
        Args: {
          p_channel: string
          p_company_id?: string
          p_payload?: Json
          p_recipient: string
          p_scheduled_at?: string
          p_template_key?: string
        }
        Returns: string
      }
      enqueue_recordatorios_cuotas: { Args: never; Returns: number }
      export_company_data: { Args: { p_company_id: string }; Returns: Json }
      export_my_data: { Args: never; Returns: Json }
      fiscal_pac_estatus: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          created_at: string
          estado_conexion: string
          estado_mensaje: string
          estado_probado_en: string
          id: string
          project_id: string
          proveedor: string
          tiene_prod: boolean
          tiene_sandbox: boolean
          updated_at: string
        }[]
      }
      generar_ocurrencias_rutas: {
        Args: { p_dias_adelante?: number }
        Returns: number
      }
      get_company_effective_limits: {
        Args: { p_company_id: string }
        Returns: {
          max_projects: number
          max_units: number
        }[]
      }
      get_company_usage: {
        Args: { p_company_id: string }
        Returns: {
          projects_count: number
          units_count: number
        }[]
      }
      get_legal_status: {
        Args: { p_locale?: string }
        Returns: {
          accepted: boolean
          accepted_at: string
          audience: string
          doc_type: string
          summary: string
          title: string
          url: string
          version: string
        }[]
      }
      get_my_cliente_id: { Args: never; Returns: string }
      get_my_company_id: { Args: never; Returns: string }
      get_my_sessions: {
        Args: never
        Returns: {
          aal: string
          created_at: string
          id: string
          ip: string
          is_current: boolean
          not_after: string
          refreshed_at: string
          updated_at: string
          user_agent: string
        }[]
      }
      get_my_user_id: { Args: never; Returns: string }
      get_superadmin_empresas: {
        Args: {
          p_limit?: number
          p_module?: string
          p_offset?: number
          p_search?: string
          p_sort?: string
          p_status?: string
        }
        Returns: {
          activa: boolean
          created_at: string
          email: string
          id: string
          max_projects: number
          max_units: number
          monthly_total_cents: number
          nit: string
          nombre: string
          plan_code: string
          project_count: number
          servicio_agua: boolean
          servicio_condominios: boolean
          subscription_status: string
          suspended_at: string
          suspended_reason: string
          telefono: string
          total_count: number
          unit_count: number
          user_count: number
        }[]
      }
      get_superadmin_mrr_trend: {
        Args: { p_days?: number }
        Returns: {
          day: string
          empresas_activas: number
          mrr_cents: number
        }[]
      }
      get_superadmin_plataforma_kpis: {
        Args: never
        Returns: {
          canceladas_30d: number
          empresas_activas: number
          empresas_inactivas: number
          mrr_cents: number
          plan_distribution: Json
          refreshed_at: string
          suscripciones_activas: number
          suscripciones_trialing: number
          suscripciones_vigentes: number
          total_empresas: number
          total_proyectos: number
          total_unidades: number
          total_usuarios: number
        }[]
      }
      get_superadmin_trends: {
        Args: { p_months?: number }
        Returns: {
          altas: number
          bajas: number
          mes: string
        }[]
      }
      get_user_permissions: {
        Args: { target_user_id: string }
        Returns: string[]
      }
      has_admin_company_access: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      has_admin_or_owner_access_in_company: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      has_admin_project_access: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      has_company_owner_company_access: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      has_operator_project_access: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      has_role_any: { Args: { p_roles: string[] }; Returns: boolean }
      has_super_admin_access: { Args: never; Returns: boolean }
      has_super_or_owner_access: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      has_viewer_project_access: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      is_company_owner: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_user_cliente_with_id: {
        Args: { p_cliente_id: string }
        Returns: boolean
      }
      is_user_in_company_with_role: {
        Args: { p_company_id: string; p_roles: string[] }
        Returns: boolean
      }
      mark_notification_result: {
        Args: {
          p_error?: string
          p_id: string
          p_ok: boolean
          p_retriable?: boolean
        }
        Returns: undefined
      }
      mark_notification_suppressed: {
        Args: { p_id: string; p_reason?: string }
        Returns: undefined
      }
      migrate_custom_auth_to_supabase_unconfirmed: {
        Args: never
        Returns: Json
      }
      mis_proyectos_ids: { Args: never; Returns: string[] }
      mis_unidad_roles: {
        Args: never
        Returns: {
          rol: string
          unidad: string
        }[]
      }
      mis_unidades_ids: { Args: never; Returns: string[] }
      notification_channel_enabled: {
        Args: { p_channel: string; p_user_id: string }
        Returns: boolean
      }
      notify_security_event: {
        Args: {
          p_event_at: string
          p_event_type: string
          p_ip: string
          p_log_id: string
          p_user_agent: string
          p_user_id: string
        }
        Returns: undefined
      }
      paquete_autorizar_salida: {
        Args: {
          p_autorizado_documento?: string
          p_autorizado_nombre: string
          p_autorizado_telefono?: string
          p_descripcion: string
          p_fotos?: string[]
          p_notas?: string
          p_tipo: string
          p_unidad_id: string
        }
        Returns: {
          autorizado_documento: string | null
          autorizado_nombre: string | null
          autorizado_telefono: string | null
          codigo_retiro: string | null
          company_id: string
          created_at: string
          descripcion: string
          direccion: string
          empresa_mensajeria: string | null
          entregado_a_nombre: string | null
          entregado_por: string | null
          entregado_via: string | null
          estado: string
          firma_path: string | null
          fotos: string[] | null
          hora_entrega: string | null
          hora_recepcion: string
          id: string
          notas: string | null
          notificado_at: string | null
          num_guia: string | null
          project_id: string
          recibido_por: string | null
          remitente: string | null
          tipo: string
          unidad_id: string
        }
        SetofOptions: {
          from: "*"
          to: "paquetes_recibidos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      paquete_firmar_recepcion: {
        Args: { p_firma_path: string; p_nombre: string; p_paquete_id: string }
        Returns: {
          autorizado_documento: string | null
          autorizado_nombre: string | null
          autorizado_telefono: string | null
          codigo_retiro: string | null
          company_id: string
          created_at: string
          descripcion: string
          direccion: string
          empresa_mensajeria: string | null
          entregado_a_nombre: string | null
          entregado_por: string | null
          entregado_via: string | null
          estado: string
          firma_path: string | null
          fotos: string[] | null
          hora_entrega: string | null
          hora_recepcion: string
          id: string
          notas: string | null
          notificado_at: string | null
          num_guia: string | null
          project_id: string
          recibido_por: string | null
          remitente: string | null
          tipo: string
          unidad_id: string
        }
        SetofOptions: {
          from: "*"
          to: "paquetes_recibidos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payfac_estatus: {
        Args: { p_company_id: string }
        Returns: {
          company_id: string
          created_at: string
          estado_conexion: string
          estado_mensaje: string
          estado_probado_en: string
          id: string
          project_id: string
          proveedor: string
          tiene_prod: boolean
          tiene_sandbox: boolean
          updated_at: string
        }[]
      }
      pop_email_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          attempts: number
          company_id: string
          id: number
          is_superadmin: boolean
          max_attempts: number
          payload: Json
          triggered_by: string
        }[]
      }
      presupuesto_estado_partida: {
        Args: { p_categoria: string; p_fecha: string; p_project_id: string }
        Returns: {
          cuenta_codigo: string
          cuenta_id: string
          cuenta_nombre: string
          disponible: number
          ejecutado: number
          periodo: string
          presupuestado: number
        }[]
      }
      presupuesto_partida_estado: {
        Args: {
          p_company_id: string
          p_cuenta_id: string
          p_periodo: string
          p_project_id: string
        }
        Returns: {
          ejecutado: number
          presupuestado: number
          presupuesto_id: string
        }[]
      }
      presupuesto_vs_real: {
        Args: { p_presupuesto_id: string }
        Returns: {
          codigo: string
          cuenta_id: string
          ejecutado: number
          naturaleza: string
          nombre: string
          periodo: string
          presupuestado: number
          variacion: number
        }[]
      }
      rate_limit_check: {
        Args: {
          p_action: string
          p_max_count: number
          p_user_id: string
          p_window?: string
        }
        Returns: boolean
      }
      rate_limit_hit: {
        Args: {
          p_action: string
          p_max_count: number
          p_subject: string
          p_window?: string
        }
        Returns: boolean
      }
      record_legal_acceptance: {
        Args: { p_doc_type: string; p_locale?: string; p_user_agent?: string }
        Returns: string
      }
      refresh_superadmin_kpis: { Args: never; Returns: undefined }
      request_password_reset:
        | {
            Args: {
              email_input: string
              ip_address?: string
              user_agent?: string
            }
            Returns: Json
          }
        | {
            Args: {
              email_input: string
              ip_address?: string
              user_agent?: string
            }
            Returns: Json
          }
      revoke_my_session: { Args: { p_session_id: string }; Returns: boolean }
      revoke_other_my_sessions: { Args: never; Returns: number }
      run_billing_sync: { Args: never; Returns: undefined }
      run_email_queue_worker: { Args: never; Returns: undefined }
      run_notifications_dispatcher: { Args: never; Returns: undefined }
      run_route_reminders: { Args: never; Returns: undefined }
      snapshot_platform_metrics: { Args: never; Returns: undefined }
      solicitar_ampliacion_limites: {
        Args: { p_max_projects: number; p_max_units: number }
        Returns: {
          max_projects: number
          max_units: number
        }[]
      }
      sso_lookup_domain: {
        Args: { p_domain: string }
        Returns: {
          enforced: boolean
          provider_id: string
          sso_available: boolean
        }[]
      }
      update_email_attempt: {
        Args: { p_error: string; p_id: number; p_ok: boolean }
        Returns: undefined
      }
      update_user_password: {
        Args: { email_input: string; new_password: string }
        Returns: Json
      }
      user_has_permission: { Args: { perm_key: string }; Returns: boolean }
      user_has_project_access: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      validate_reset_token:
        | {
            Args: { token_input: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.validate_reset_token(token_input => text), public.validate_reset_token(token_input => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { token_input: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.validate_reset_token(token_input => text), public.validate_reset_token(token_input => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
