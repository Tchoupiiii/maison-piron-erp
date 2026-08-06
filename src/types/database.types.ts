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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          actor_id: string | null
          actor_name: string
          actor_role: Database["public"]["Enums"]["staff_role"] | null
          changes: Json | null
          entity_id: string | null
          entity_label: string | null
          entity_type: string | null
          id: number
          ip_address: unknown
          occurred_at: string
          summary: string
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          actor_id?: string | null
          actor_name: string
          actor_role?: Database["public"]["Enums"]["staff_role"] | null
          changes?: Json | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          id?: never
          ip_address?: unknown
          occurred_at?: string
          summary: string
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          actor_id?: string | null
          actor_name?: string
          actor_role?: Database["public"]["Enums"]["staff_role"] | null
          changes?: Json | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          id?: never
          ip_address?: unknown
          occurred_at?: string
          summary?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          blurb: string | null
          created_at: string
          hero_storage_path: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          slug: string
          sort: number
          updated_at: string
        }
        Insert: {
          blurb?: string | null
          created_at?: string
          hero_storage_path?: string | null
          id?: string
          is_active?: boolean
          kind: string
          name: string
          slug: string
          sort?: number
          updated_at?: string
        }
        Update: {
          blurb?: string | null
          created_at?: string
          hero_storage_path?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          slug?: string
          sort?: number
          updated_at?: string
        }
        Relationships: []
      }
      customer_consents: {
        Row: {
          customer_id: string
          expires_at: string | null
          granted: boolean
          id: string
          recorded_at: string
          source: string | null
        }
        Insert: {
          customer_id: string
          expires_at?: string | null
          granted: boolean
          id?: string
          recorded_at?: string
          source?: string | null
        }
        Update: {
          customer_id?: string
          expires_at?: string | null
          granted?: boolean
          id?: string
          recorded_at?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_preferences: {
        Row: {
          contact_language: Database["public"]["Enums"]["contact_language"]
          customer_id: string
          preferred_metal: Database["public"]["Enums"]["metal_kind"] | null
          preferred_stone: string | null
          ring_size_eu: number | null
        }
        Insert: {
          contact_language?: Database["public"]["Enums"]["contact_language"]
          customer_id: string
          preferred_metal?: Database["public"]["Enums"]["metal_kind"] | null
          preferred_stone?: string | null
          ring_size_eu?: number | null
        }
        Update: {
          contact_language?: Database["public"]["Enums"]["contact_language"]
          customer_id?: string
          preferred_metal?: Database["public"]["Enums"]["metal_kind"] | null
          preferred_stone?: string | null
          ring_size_eu?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_preferences_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          anonymized_at: string | null
          auth_user_id: string | null
          city: string | null
          country: string | null
          created_at: string
          customer_since: string
          email: string | null
          full_name: string | null
          id: string
          is_anonymized: boolean
          is_privilege: boolean
          lifetime_value: number
          phone: string | null
          postal_code: string | null
          street: string | null
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          auth_user_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          customer_since?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_anonymized?: boolean
          is_privilege?: boolean
          lifetime_value?: number
          phone?: string | null
          postal_code?: string | null
          street?: string | null
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          auth_user_id?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          customer_since?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_anonymized?: boolean
          is_privilege?: boolean
          lifetime_value?: number
          phone?: string | null
          postal_code?: string | null
          street?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      daily_market_brief: {
        Row: {
          body: string
          brief_date: string
          generated_at: string
          model: string
          source_data: Json
        }
        Insert: {
          body: string
          brief_date: string
          generated_at?: string
          model: string
          source_data?: Json
        }
        Update: {
          body?: string
          brief_date?: string
          generated_at?: string
          model?: string
          source_data?: Json
        }
        Relationships: []
      }
      maison_settings: {
        Row: {
          city: string
          country: string
          display_name: string
          id: boolean
          legal_name: string
          postal_code: string
          street: string
          updated_at: string
          vat_number: string
        }
        Insert: {
          city: string
          country: string
          display_name: string
          id?: boolean
          legal_name: string
          postal_code: string
          street: string
          updated_at?: string
          vat_number: string
        }
        Update: {
          city?: string
          country?: string
          display_name?: string
          id?: boolean
          legal_name?: string
          postal_code?: string
          street?: string
          updated_at?: string
          vat_number?: string
        }
        Relationships: []
      }
      market_rates: {
        Row: {
          fetched_at: string
          id: string
          metal_kind: Database["public"]["Enums"]["metal_kind"]
          price_eur_per_gram_fine: number
          rate_date: string
          raw_response: Json | null
          source: string
        }
        Insert: {
          fetched_at?: string
          id?: string
          metal_kind: Database["public"]["Enums"]["metal_kind"]
          price_eur_per_gram_fine: number
          rate_date: string
          raw_response?: Json | null
          source: string
        }
        Update: {
          fetched_at?: string
          id?: string
          metal_kind?: Database["public"]["Enums"]["metal_kind"]
          price_eur_per_gram_fine?: number
          rate_date?: string
          raw_response?: Json | null
          source?: string
        }
        Relationships: []
      }
      metal_sync_log: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          http_status: number | null
          id: string
          rates_upserted: number
          started_at: string
          status: Database["public"]["Enums"]["sync_status"]
          triggered_by: string
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          rates_upserted?: number
          started_at?: string
          status: Database["public"]["Enums"]["sync_status"]
          triggered_by?: string
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: string
          rates_upserted?: number
          started_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
          triggered_by?: string
        }
        Relationships: []
      }
      metal_titles: {
        Row: {
          karat: number | null
          label: string
          metal_kind: Database["public"]["Enums"]["metal_kind"]
          purity_per_mille: number
          sort: number
        }
        Insert: {
          karat?: number | null
          label: string
          metal_kind: Database["public"]["Enums"]["metal_kind"]
          purity_per_mille: number
          sort?: number
        }
        Update: {
          karat?: number | null
          label?: string
          metal_kind?: Database["public"]["Enums"]["metal_kind"]
          purity_per_mille?: number
          sort?: number
        }
        Relationships: []
      }
      permission_catalogue: {
        Row: {
          category: string
          description: string
          key: string
          label: string
          sort: number
        }
        Insert: {
          category: string
          description: string
          key: string
          label: string
          sort?: number
        }
        Update: {
          category?: string
          description?: string
          key?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      pos_terminals: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          location: string | null
          name: string
          receipt_format: string
          scanner_mode: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          receipt_format?: string
          scanner_mode?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          receipt_format?: string
          scanner_mode?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          computed_at: string
          ht: number
          id: string
          labor_cost: number
          margin_multiplier: number
          metal_cost: number
          product_id: string
          rate_date_used: string | null
          reason: Database["public"]["Enums"]["price_change_reason"]
          stone_cost: number
          ttc: number
        }
        Insert: {
          computed_at?: string
          ht: number
          id?: string
          labor_cost: number
          margin_multiplier: number
          metal_cost: number
          product_id: string
          rate_date_used?: string | null
          reason: Database["public"]["Enums"]["price_change_reason"]
          stone_cost: number
          ttc: number
        }
        Update: {
          computed_at?: string
          ht?: number
          id?: string
          labor_cost?: number
          margin_multiplier?: number
          metal_cost?: number
          product_id?: string
          rate_date_used?: string | null
          reason?: Database["public"]["Enums"]["price_change_reason"]
          stone_cost?: number
          ttc?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_gemstones: {
        Row: {
          carat_weight: number
          certificate_lab: Database["public"]["Enums"]["certificate_lab"]
          certificate_number: string | null
          clarity: string | null
          color: string | null
          cut: string | null
          gemstone_type: Database["public"]["Enums"]["gemstone_type"]
          id: string
          name: string
          price_per_carat: number
          product_id: string
          stone_count: number
        }
        Insert: {
          carat_weight: number
          certificate_lab?: Database["public"]["Enums"]["certificate_lab"]
          certificate_number?: string | null
          clarity?: string | null
          color?: string | null
          cut?: string | null
          gemstone_type: Database["public"]["Enums"]["gemstone_type"]
          id?: string
          name: string
          price_per_carat?: number
          product_id: string
          stone_count?: number
        }
        Update: {
          carat_weight?: number
          certificate_lab?: Database["public"]["Enums"]["certificate_lab"]
          certificate_number?: string | null
          clarity?: string | null
          color?: string | null
          cut?: string | null
          gemstone_type?: Database["public"]["Enums"]["gemstone_type"]
          id?: string
          name?: string
          price_per_carat?: number
          product_id?: string
          stone_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_gemstones_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_gemstones_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_gemstones_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_materials: {
        Row: {
          color: Database["public"]["Enums"]["metal_color"] | null
          detail: string | null
          id: string
          metal_kind: Database["public"]["Enums"]["metal_kind"]
          product_id: string
          purity_per_mille: number
          weight_grams: number
        }
        Insert: {
          color?: Database["public"]["Enums"]["metal_color"] | null
          detail?: string | null
          id?: string
          metal_kind: Database["public"]["Enums"]["metal_kind"]
          product_id: string
          purity_per_mille: number
          weight_grams: number
        }
        Update: {
          color?: Database["public"]["Enums"]["metal_color"] | null
          detail?: string | null
          id?: string
          metal_kind?: Database["public"]["Enums"]["metal_kind"]
          product_id?: string
          purity_per_mille?: number
          weight_grams?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_media: {
        Row: {
          bucket_id: string
          created_at: string
          gemstone_id: string | null
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          position: number
          product_id: string
          storage_path: string
        }
        Insert: {
          bucket_id?: string
          created_at?: string
          gemstone_id?: string | null
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          position?: number
          product_id: string
          storage_path: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          gemstone_id?: string | null
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          position?: number
          product_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_gemstone_id_fkey"
            columns: ["gemstone_id"]
            isOneToOne: false
            referencedRelation: "product_gemstones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      products: {
        Row: {
          brand_id: string | null
          cached_ht: number | null
          cached_metal_cost: number | null
          cached_stone_cost: number | null
          cached_ttc: number | null
          category: Database["public"]["Enums"]["product_category"] | null
          created_at: string
          description: string | null
          id: string
          is_piece_unique: boolean
          labor_cost_eur: number
          labor_description: string | null
          margin_multiplier: number
          name: string
          price_computed_at: string | null
          rfid_tag: string | null
          showcase_slot: string | null
          sku: string
          sold_at: string | null
          status: Database["public"]["Enums"]["product_status"]
          supply_mode: string
          univers: Database["public"]["Enums"]["product_univers"] | null
          updated_at: string
          web_description: string | null
          web_published: boolean
          web_published_at: string | null
          web_slug: string | null
          web_sort: number | null
        }
        Insert: {
          brand_id?: string | null
          cached_ht?: number | null
          cached_metal_cost?: number | null
          cached_stone_cost?: number | null
          cached_ttc?: number | null
          category?: Database["public"]["Enums"]["product_category"] | null
          created_at?: string
          description?: string | null
          id?: string
          is_piece_unique?: boolean
          labor_cost_eur?: number
          labor_description?: string | null
          margin_multiplier?: number
          name: string
          price_computed_at?: string | null
          rfid_tag?: string | null
          showcase_slot?: string | null
          sku: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supply_mode?: string
          univers?: Database["public"]["Enums"]["product_univers"] | null
          updated_at?: string
          web_description?: string | null
          web_published?: boolean
          web_published_at?: string | null
          web_slug?: string | null
          web_sort?: number | null
        }
        Update: {
          brand_id?: string | null
          cached_ht?: number | null
          cached_metal_cost?: number | null
          cached_stone_cost?: number | null
          cached_ttc?: number | null
          category?: Database["public"]["Enums"]["product_category"] | null
          created_at?: string
          description?: string | null
          id?: string
          is_piece_unique?: boolean
          labor_cost_eur?: number
          labor_description?: string | null
          margin_multiplier?: number
          name?: string
          price_computed_at?: string | null
          rfid_tag?: string | null
          showcase_slot?: string | null
          sku?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supply_mode?: string
          univers?: Database["public"]["Enums"]["product_univers"] | null
          updated_at?: string
          web_description?: string | null
          web_published?: boolean
          web_published_at?: string | null
          web_slug?: string | null
          web_sort?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_photos: {
        Row: {
          created_at: string
          id: string
          phase: Database["public"]["Enums"]["repair_photo_phase"]
          repair_ticket_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          phase: Database["public"]["Enums"]["repair_photo_phase"]
          repair_ticket_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          phase?: Database["public"]["Enums"]["repair_photo_phase"]
          repair_ticket_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_photos_repair_ticket_id_fkey"
            columns: ["repair_ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["repair_status"] | null
          id: string
          repair_ticket_id: string
          to_status: Database["public"]["Enums"]["repair_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["repair_status"] | null
          id?: string
          repair_ticket_id: string
          to_status: Database["public"]["Enums"]["repair_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["repair_status"] | null
          id?: string
          repair_ticket_id?: string
          to_status?: Database["public"]["Enums"]["repair_status"]
        }
        Relationships: [
          {
            foreignKeyName: "repair_status_history_repair_ticket_id_fkey"
            columns: ["repair_ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_tickets: {
        Row: {
          actual_price: number | null
          created_at: string
          customer_id: string
          deadline: string | null
          delivered_at: string | null
          description: string
          estimated_price: number | null
          id: string
          product_id: string | null
          received_date: string
          ref: string
          status: Database["public"]["Enums"]["repair_status"]
          updated_at: string
        }
        Insert: {
          actual_price?: number | null
          created_at?: string
          customer_id: string
          deadline?: string | null
          delivered_at?: string | null
          description: string
          estimated_price?: number | null
          id?: string
          product_id?: string | null
          received_date?: string
          ref?: string
          status?: Database["public"]["Enums"]["repair_status"]
          updated_at?: string
        }
        Update: {
          actual_price?: number | null
          created_at?: string
          customer_id?: string
          deadline?: string | null
          delivered_at?: string | null
          description?: string
          estimated_price?: number | null
          id?: string
          product_id?: string | null
          received_date?: string
          ref?: string
          status?: Database["public"]["Enums"]["repair_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tickets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tickets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tickets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      rgpd_action_log: {
        Row: {
          action: Database["public"]["Enums"]["rgpd_action"]
          customer_id: string
          id: string
          notes: string | null
          performed_at: string
          performed_by: string | null
          receipt_sent_at: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["rgpd_action"]
          customer_id: string
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string | null
          receipt_sent_at?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["rgpd_action"]
          customer_id?: string
          id?: string
          notes?: string | null
          performed_at?: string
          performed_by?: string | null
          receipt_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rgpd_action_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_key: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Insert: {
          permission_key: string
          role: Database["public"]["Enums"]["staff_role"]
        }
        Update: {
          permission_key?: string
          role?: Database["public"]["Enums"]["staff_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permission_catalogue"
            referencedColumns: ["key"]
          },
        ]
      }
      staff_permissions: {
        Row: {
          granted: boolean
          permission_key: string
          staff_id: string
          updated_at: string
        }
        Insert: {
          granted: boolean
          permission_key: string
          staff_id: string
          updated_at?: string
        }
        Update: {
          granted?: boolean
          permission_key?: string
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permission_catalogue"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "staff_permissions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      stock_holds: {
        Row: {
          cart_ref: string
          channel: string
          created_at: string
          expires_at: string
          held_by: string | null
          id: string
          product_id: string
          release_reason: string | null
          released_at: string | null
          terminal_id: string | null
        }
        Insert: {
          cart_ref: string
          channel: string
          created_at?: string
          expires_at: string
          held_by?: string | null
          id?: string
          product_id: string
          release_reason?: string | null
          released_at?: string | null
          terminal_id?: string | null
        }
        Update: {
          cart_ref?: string
          channel?: string
          created_at?: string
          expires_at?: string
          held_by?: string | null
          id?: string
          product_id?: string
          release_reason?: string | null
          released_at?: string | null
          terminal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_holds_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_holds_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_holds_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_holds_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          actor_id: string | null
          cart_ref: string | null
          channel: string | null
          id: number
          kind: Database["public"]["Enums"]["stock_movement_kind"]
          note: string | null
          occurred_at: string
          product_id: string
          source_item_id: string | null
          transaction_id: string | null
        }
        Insert: {
          actor_id?: string | null
          cart_ref?: string | null
          channel?: string | null
          id?: never
          kind: Database["public"]["Enums"]["stock_movement_kind"]
          note?: string | null
          occurred_at?: string
          product_id: string
          source_item_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          actor_id?: string | null
          cart_ref?: string | null
          channel?: string | null
          id?: never
          kind?: Database["public"]["Enums"]["stock_movement_kind"]
          note?: string | null
          occurred_at?: string
          product_id?: string
          source_item_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "transaction_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_items: {
        Row: {
          description: string
          id: string
          line_total_ht: number | null
          line_total_ttc: number | null
          product_id: string | null
          quantity: number
          repair_ticket_id: string | null
          transaction_id: string
          unit_price_ht: number
          vat_rate: number
        }
        Insert: {
          description: string
          id?: string
          line_total_ht?: number | null
          line_total_ttc?: number | null
          product_id?: string | null
          quantity?: number
          repair_ticket_id?: string | null
          transaction_id: string
          unit_price_ht: number
          vat_rate?: number
        }
        Update: {
          description?: string
          id?: string
          line_total_ht?: number | null
          line_total_ttc?: number | null
          product_id?: string | null
          quantity?: number
          repair_ticket_id?: string | null
          transaction_id?: string
          unit_price_ht?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "transaction_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "transaction_items_repair_ticket_id_fkey"
            columns: ["repair_ticket_id"]
            isOneToOne: false
            referencedRelation: "repair_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_paid: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          discount_amount: number
          due_at: string | null
          id: string
          issued_at: string | null
          outstanding_balance: number | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          pdf_storage_path: string | null
          ref: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          terminal_id: string | null
          total_amount: number
          vat_rate: number
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_amount?: number
          due_at?: string | null
          id?: string
          issued_at?: string | null
          outstanding_balance?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          pdf_storage_path?: string | null
          ref?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          terminal_id?: string | null
          total_amount?: number
          vat_rate?: number
        }
        Update: {
          amount_paid?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          discount_amount?: number
          due_at?: string | null
          id?: string
          issued_at?: string | null
          outstanding_balance?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          pdf_storage_path?: string | null
          ref?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          terminal_id?: string | null
          total_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      web_enquiries: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          handled_at: string | null
          handled_by: string | null
          handled_note: string | null
          id: string
          kind: Database["public"]["Enums"]["enquiry_kind"]
          message: string | null
          phone: string | null
          product_id: string | null
          status: Database["public"]["Enums"]["enquiry_status"]
          subject: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          handled_at?: string | null
          handled_by?: string | null
          handled_note?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["enquiry_kind"]
          message?: string | null
          phone?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"]
          subject?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          handled_at?: string | null
          handled_by?: string | null
          handled_note?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["enquiry_kind"]
          message?: string | null
          phone?: string | null
          product_id?: string | null
          status?: Database["public"]["Enums"]["enquiry_status"]
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "web_enquiries_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_enquiries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_enquiries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_enquiries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      web_order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          snapshot_at: string
          unit_price_ttc_snapshot: number
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          snapshot_at?: string
          unit_price_ttc_snapshot: number
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          snapshot_at?: string
          unit_price_ttc_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "web_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "web_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
      web_orders: {
        Row: {
          cart_ref: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          customer_id: string | null
          expires_at: string | null
          failed_reason: string | null
          fulfilment_mode: Database["public"]["Enums"]["fulfilment_mode"]
          id: string
          mollie_payment_id: string | null
          paid_at: string | null
          ref: string | null
          refunded_at: string | null
          shipping_city: string | null
          shipping_country: string
          shipping_fee_ttc: number
          shipping_postal_code: string | null
          shipping_street: string | null
          status: Database["public"]["Enums"]["web_order_status"]
          subtotal_ttc: number
          total_ttc: number
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          cart_ref: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at?: string | null
          failed_reason?: string | null
          fulfilment_mode?: Database["public"]["Enums"]["fulfilment_mode"]
          id?: string
          mollie_payment_id?: string | null
          paid_at?: string | null
          ref?: string | null
          refunded_at?: string | null
          shipping_city?: string | null
          shipping_country?: string
          shipping_fee_ttc?: number
          shipping_postal_code?: string | null
          shipping_street?: string | null
          status?: Database["public"]["Enums"]["web_order_status"]
          subtotal_ttc?: number
          total_ttc?: number
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          cart_ref?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          customer_id?: string | null
          expires_at?: string | null
          failed_reason?: string | null
          fulfilment_mode?: Database["public"]["Enums"]["fulfilment_mode"]
          id?: string
          mollie_payment_id?: string | null
          paid_at?: string | null
          ref?: string | null
          refunded_at?: string | null
          shipping_city?: string | null
          shipping_country?: string
          shipping_fee_ttc?: number
          shipping_postal_code?: string | null
          shipping_street?: string | null
          status?: Database["public"]["Enums"]["web_order_status"]
          subtotal_ttc?: number
          total_ttc?: number
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_orders_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlist_items: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          product_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "web_catalogue"
            referencedColumns: ["product_id"]
          },
        ]
      }
    }
    Views: {
      product_availability: {
        Row: {
          cached_ttc: number | null
          held_cart: string | null
          held_channel: string | null
          held_until: string | null
          id: string | null
          is_available: boolean | null
          name: string | null
          rfid_tag: string | null
          sku: string | null
          status: Database["public"]["Enums"]["product_status"] | null
        }
        Relationships: []
      }
      web_brands: {
        Row: {
          blurb: string | null
          hero_storage_path: string | null
          kind: string | null
          name: string | null
          published_count: number | null
          slug: string | null
          sort: number | null
        }
        Insert: {
          blurb?: string | null
          hero_storage_path?: string | null
          kind?: string | null
          name?: string | null
          published_count?: never
          slug?: string | null
          sort?: number | null
        }
        Update: {
          blurb?: string | null
          hero_storage_path?: string | null
          kind?: string | null
          name?: string | null
          published_count?: never
          slug?: string | null
          sort?: number | null
        }
        Relationships: []
      }
      web_catalogue: {
        Row: {
          brand_kind: string | null
          brand_name: string | null
          brand_slug: string | null
          category: string | null
          description: string | null
          gemstones_label: string | null
          is_available: boolean | null
          is_piece_unique: boolean | null
          materials_label: string | null
          name: string | null
          price_computed_at: string | null
          price_ttc: number | null
          product_id: string | null
          slug: string | null
          status: string | null
          supply_mode: string | null
          univers: string | null
          web_published_at: string | null
          web_sort: number | null
        }
        Relationships: []
      }
      web_maison: {
        Row: {
          city: string | null
          country: string | null
          display_name: string | null
          legal_name: string | null
          postal_code: string | null
          street: string | null
          vat_number: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          display_name?: string | null
          legal_name?: string | null
          postal_code?: string | null
          street?: string | null
          vat_number?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          display_name?: string | null
          legal_name?: string | null
          postal_code?: string | null
          street?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      web_product_media: {
        Row: {
          media_type: string | null
          position: number | null
          slug: string | null
          storage_path: string | null
        }
        Relationships: []
      }
      web_product_stones: {
        Row: {
          carat_weight: number | null
          certificate_lab: string | null
          clarity: string | null
          color: string | null
          cut: string | null
          gemstone_type: string | null
          name: string | null
          slug: string | null
          stone_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_active_sessions: {
        Args: never
        Returns: {
          full_name: string
          ip: string
          last_seen_at: string
          login: string
          role: Database["public"]["Enums"]["staff_role"]
          session_id: string
          started_at: string
          user_agent: string
          user_id: string
        }[]
      }
      admin_delete_staff: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      admin_revoke_sessions: {
        Args: { target_user_id: string }
        Returns: number
      }
      admin_set_staff_active: {
        Args: { active_param: boolean; target_user_id: string }
        Returns: undefined
      }
      admin_set_staff_role: {
        Args: {
          role_param: Database["public"]["Enums"]["staff_role"]
          target_user_id: string
        }
        Returns: undefined
      }
      admin_update_maison_settings: {
        Args: {
          city_param: string
          country_param: string
          display_name_param: string
          legal_name_param: string
          postal_code_param: string
          street_param: string
          vat_number_param: string
        }
        Returns: undefined
      }
      admin_update_staff_identity: {
        Args: {
          email_param: string
          full_name_param: string
          target_user_id: string
          username_param: string
        }
        Returns: undefined
      }
      anonymize_stale_web_enquiries: { Args: never; Returns: number }
      auth_email_for_username: {
        Args: { username_param: string }
        Returns: string
      }
      calculate_dynamic_price: {
        Args: { product_id_param: string; rate_date_param?: string }
        Returns: {
          has_missing_rate: boolean
          ht: number
          labor_cost: number
          margin_multiplier: number
          metal_cost: number
          rate_date_used: string
          stone_cost: number
          ttc: number
        }[]
      }
      check_auth_rate_limit: {
        Args: {
          action_param: string
          identifier_param: string
          max_attempts_param: number
          window_minutes_param: number
        }
        Returns: boolean
      }
      create_sale: {
        Args: {
          cart_ref_param?: string
          customer_id_param?: string
          discount_param?: number
          emit_invoice_param?: boolean
          items_param: Json
          mark_paid_param?: boolean
          payment_method_param?: Database["public"]["Enums"]["payment_method"]
          terminal_id_param?: string
        }
        Returns: {
          total_amount: number
          transaction_id: string
          transaction_ref: string
        }[]
      }
      emit_invoice: {
        Args: { due_days_param?: number; transaction_id_param: string }
        Returns: {
          customer_email: string
          customer_name: string
          due_at: string
          ref: string
          total_amount: number
        }[]
      }
      link_customer_account: {
        Args: {
          full_name_param?: string
          marketing_param?: boolean
          phone_param?: string
        }
        Returns: string
      }
      log_activity: {
        Args: {
          action_param: Database["public"]["Enums"]["activity_action"]
          changes_param?: Json
          entity_id_param?: string
          entity_label_param?: string
          entity_type_param?: string
          ip_param?: string
          summary_param: string
          user_agent_param?: string
        }
        Returns: number
      }
      mark_invoice_sent: {
        Args: { transaction_id_param: string }
        Returns: undefined
      }
      my_permissions: { Args: never; Returns: string[] }
      record_payment: {
        Args: { amount_param: number; transaction_id_param: string }
        Returns: {
          amount_paid: number
          outstanding: number
          status: Database["public"]["Enums"]["transaction_status"]
        }[]
      }
      release_expired_holds: { Args: never; Returns: number }
      release_hold: {
        Args: {
          cart_ref_param: string
          product_id_param?: string
          reason_param?: string
        }
        Returns: number
      }
      repriceable_product_ids: { Args: never; Returns: string[] }
      return_sold_item: {
        Args: { reason_param?: string; transaction_item_id_param: string }
        Returns: {
          amount: number
          credit_note_id: string
          credit_note_ref: string
        }[]
      }
      scan_product: {
        Args: {
          cart_ref_param: string
          channel_param?: string
          code_param: string
          minutes_param?: number
          terminal_id_param?: string
        }
        Returns: {
          hold_expires_at: string
          name: string
          price_ttc: number
          product_id: string
          sku: string
        }[]
      }
      set_enquiry_status: {
        Args: {
          enquiry_id_param: string
          note_param?: string
          status_param: Database["public"]["Enums"]["enquiry_status"]
        }
        Returns: undefined
      }
      set_marketing_consent: {
        Args: { granted_param: boolean }
        Returns: undefined
      }
      set_product_status: {
        Args: {
          product_id_param: string
          status_param: Database["public"]["Enums"]["product_status"]
        }
        Returns: undefined
      }
      set_repair_status: {
        Args: {
          status_param: Database["public"]["Enums"]["repair_status"]
          ticket_id_param: string
        }
        Returns: {
          customer_email: string
          customer_name: string
          previous_status: Database["public"]["Enums"]["repair_status"]
          ticket_ref: string
        }[]
      }
      web_attach_payment: {
        Args: { cart_ref_param: string; mollie_payment_id_param: string }
        Returns: undefined
      }
      web_begin_checkout: {
        Args: {
          cart_ref_param: string
          city_param?: string
          contact_email_param?: string
          contact_name_param?: string
          contact_phone_param?: string
          fulfilment_param: Database["public"]["Enums"]["fulfilment_mode"]
          postal_code_param?: string
          shipping_fee_param: number
          street_param?: string
        }
        Returns: {
          order_id: string
          shipping_ttc: number
          subtotal_ttc: number
          total_ttc: number
        }[]
      }
      web_cart: {
        Args: { cart_ref_param: string }
        Returns: {
          brand_name: string
          current_ttc: number
          hold_expires_at: string
          name: string
          price_ttc: number
          product_id: string
          slug: string
          snapshot_at: string
          still_held: boolean
        }[]
      }
      web_confirm_paid: {
        Args: {
          mollie_payment_id_param: string
          order_id_param: string
          payment_method_param?: Database["public"]["Enums"]["payment_method"]
        }
        Returns: {
          already_done: boolean
          order_ref: string
          total_amount: number
          transaction_id: string
          transaction_ref: string
        }[]
      }
      web_fail_order: {
        Args: {
          order_id_param: string
          reason_param?: string
          status_param: Database["public"]["Enums"]["web_order_status"]
        }
        Returns: undefined
      }
      web_hold_product: {
        Args: { cart_ref_param: string; slug_param: string }
        Returns: {
          hold_expires_at: string
          name: string
          price_ttc: number
          product_id: string
          slug: string
        }[]
      }
      web_order_status: {
        Args: { cart_ref_param: string }
        Returns: {
          failed_reason: string
          fulfilment: Database["public"]["Enums"]["fulfilment_mode"]
          order_id: string
          paid_at: string
          ref: string
          status: Database["public"]["Enums"]["web_order_status"]
          total_ttc: number
        }[]
      }
      web_release: {
        Args: { cart_ref_param: string; product_id_param?: string }
        Returns: number
      }
      web_submit_enquiry: {
        Args: {
          email_param: string
          full_name_param: string
          honeypot_param?: string
          kind_param: Database["public"]["Enums"]["enquiry_kind"]
          message_param: string
          phone_param?: string
          product_slug_param?: string
          subject_param?: string
        }
        Returns: string
      }
      wishlist_add: { Args: { slug_param: string }; Returns: string }
      wishlist_list: {
        Args: never
        Returns: {
          added_at: string
          brand_name: string
          is_available: boolean
          is_published: boolean
          name: string
          price_ttc: number
          product_id: string
          slug: string
          wishlist_id: string
        }[]
      }
      wishlist_remove: { Args: { slug_param: string }; Returns: undefined }
    }
    Enums: {
      activity_action:
        | "connexion"
        | "deconnexion"
        | "produit_cree"
        | "produit_modifie"
        | "produit_statut"
        | "produit_supprime"
        | "prix_modifie"
        | "prix_recalcule"
        | "ticket_cree"
        | "ticket_statut"
        | "client_cree"
        | "client_modifie"
        | "client_supprime"
        | "client_anonymise"
        | "client_exporte"
        | "vente_creee"
        | "facture_emise"
        | "paiement_enregistre"
        | "employe_cree"
        | "employe_modifie"
        | "employe_desactive"
        | "employe_supprime"
        | "session_revoquee"
        | "permission_modifiee"
        | "caisse_creee"
        | "caisse_modifiee"
        | "sync_metaux"
        | "maison_modifiee"
        | "web_produit_publie"
        | "web_commande_payee"
        | "web_commande_echouee"
        | "web_demande_recue"
        | "web_marque_modifiee"
        | "panier_libere"
        | "web_enquiry_anonymisee"
      certificate_lab: "GIA" | "IGI" | "HRD" | "autre" | "aucun"
      contact_language: "fr" | "nl" | "en" | "de"
      enquiry_kind: "rendez_vous" | "question" | "estimation" | "autre"
      enquiry_status: "nouvelle" | "en_cours" | "traitee"
      fulfilment_mode: "retrait_boutique" | "envoi_belgique"
      gemstone_type:
        | "diamant"
        | "emeraude"
        | "saphir"
        | "rubis"
        | "perle"
        | "autre"
      media_type:
        | "packshot"
        | "profil"
        | "porte"
        | "poincon"
        | "certificat"
        | "macro"
      metal_color: "jaune" | "blanc" | "rose"
      metal_kind: "or" | "argent" | "platine"
      payment_method: "especes" | "bancontact" | "carte" | "virement" | "mixte"
      price_change_reason: "creation" | "edition_manuelle" | "sync_cours"
      product_category:
        | "Bagues"
        | "Boucles d'oreilles"
        | "Mono boucles d'oreilles"
        | "Bracelets"
        | "Colliers"
        | "Pendentifs"
        | "Fermoirs"
        | "Montres"
      product_status: "en_stock" | "reserve" | "vendu"
      product_univers:
        | "Joaillerie"
        | "Fiançailles"
        | "Mariage"
        | "Horlogerie"
        | "Accessoires"
        | "Seconde main"
      repair_photo_phase: "avant" | "apres"
      repair_status: "check_in" | "at_bench" | "ready" | "delivered"
      rgpd_action: "anonymisation" | "export"
      staff_role: "admin" | "gemmologue" | "vendeuse"
      stock_movement_kind:
        | "entree"
        | "reservation"
        | "liberation"
        | "vente"
        | "retour"
      sync_status: "succes" | "echec" | "partiel"
      transaction_status:
        | "brouillon"
        | "emise"
        | "payee_partielle"
        | "payee"
        | "annulee"
      web_order_status:
        | "panier"
        | "en_attente_paiement"
        | "payee"
        | "echouee"
        | "expiree"
        | "remboursee"
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
    Enums: {
      activity_action: [
        "connexion",
        "deconnexion",
        "produit_cree",
        "produit_modifie",
        "produit_statut",
        "produit_supprime",
        "prix_modifie",
        "prix_recalcule",
        "ticket_cree",
        "ticket_statut",
        "client_cree",
        "client_modifie",
        "client_supprime",
        "client_anonymise",
        "client_exporte",
        "vente_creee",
        "facture_emise",
        "paiement_enregistre",
        "employe_cree",
        "employe_modifie",
        "employe_desactive",
        "employe_supprime",
        "session_revoquee",
        "permission_modifiee",
        "caisse_creee",
        "caisse_modifiee",
        "sync_metaux",
        "maison_modifiee",
        "web_produit_publie",
        "web_commande_payee",
        "web_commande_echouee",
        "web_demande_recue",
        "web_marque_modifiee",
        "panier_libere",
        "web_enquiry_anonymisee",
      ],
      certificate_lab: ["GIA", "IGI", "HRD", "autre", "aucun"],
      contact_language: ["fr", "nl", "en", "de"],
      enquiry_kind: ["rendez_vous", "question", "estimation", "autre"],
      enquiry_status: ["nouvelle", "en_cours", "traitee"],
      fulfilment_mode: ["retrait_boutique", "envoi_belgique"],
      gemstone_type: [
        "diamant",
        "emeraude",
        "saphir",
        "rubis",
        "perle",
        "autre",
      ],
      media_type: [
        "packshot",
        "profil",
        "porte",
        "poincon",
        "certificat",
        "macro",
      ],
      metal_color: ["jaune", "blanc", "rose"],
      metal_kind: ["or", "argent", "platine"],
      payment_method: ["especes", "bancontact", "carte", "virement", "mixte"],
      price_change_reason: ["creation", "edition_manuelle", "sync_cours"],
      product_category: [
        "Bagues",
        "Boucles d'oreilles",
        "Mono boucles d'oreilles",
        "Bracelets",
        "Colliers",
        "Pendentifs",
        "Fermoirs",
        "Montres",
      ],
      product_status: ["en_stock", "reserve", "vendu"],
      product_univers: [
        "Joaillerie",
        "Fiançailles",
        "Mariage",
        "Horlogerie",
        "Accessoires",
        "Seconde main",
      ],
      repair_photo_phase: ["avant", "apres"],
      repair_status: ["check_in", "at_bench", "ready", "delivered"],
      rgpd_action: ["anonymisation", "export"],
      staff_role: ["admin", "gemmologue", "vendeuse"],
      stock_movement_kind: [
        "entree",
        "reservation",
        "liberation",
        "vente",
        "retour",
      ],
      sync_status: ["succes", "echec", "partiel"],
      transaction_status: [
        "brouillon",
        "emise",
        "payee_partielle",
        "payee",
        "annulee",
      ],
      web_order_status: [
        "panier",
        "en_attente_paiement",
        "payee",
        "echouee",
        "expiree",
        "remboursee",
      ],
    },
  },
} as const
