// Hand-written mirrors of the backend Pydantic models — keep both sides in sync.

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  role: "admin" | "manager" | "member";
  status: string;
  gerance_id: string | null;
  permissions: string[];
  profile_complete: boolean;
  identity_status: string;
  address: string | null;
  extra_info: string | null;
}

export interface Manager {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  status: string;
  gerance_id: string;
  gerance_name: string;
  permissions: string[];
  tontine_count: number;
}

export interface Gerance {
  id: string;
  name: string;
  owner_id: string;
  owner_name: string;
  is_admin_gerance: boolean;
  tontine_count: number;
  member_count: number;
  total_expected: number;
  total_paid: number;
  total_pending: number;
  total_late: number;
  total_penalties: number;
}

export interface MyGerance {
  id: string;
  name: string;
  is_admin_gerance: boolean;
  tontine_count: number;
  member_count: number;
  total_expected: number;
  total_paid: number;
  total_pending: number;
  total_late: number;
  total_penalties: number;
}

export interface Tontine {
  id: string;
  gerance_id: string;
  gerance_name: string;
  name: string;
  description: string;
  member_count: number;
  daily_amount: number;
  payout_amount: number;
  interval_days: number;
  beneficiary_count: number;
  duration_days: number;
  start_date: string;
  end_date: string;
  deadline_time: string;
  penalty_per_day: number;
  timezone: string;
  status: string;
  is_existing: boolean;
  created_by: string;
  joined_count: number;
}

export interface Position {
  id: string;
  tontine_id: string;
  gerance_id: string;
  index: number;
  payout_date: string;
  member_id: string | null;
  member_name: string | null;
  status: string;
}

export interface MembershipRequest {
  id: string;
  tontine_id: string;
  tontine_name: string;
  gerance_id: string;
  gerance_name: string;
  member_id: string;
  member_name: string;
  member_phone: string;
  status: string;
  created_at: string;
  decided_at: string | null;
}

export interface Contract {
  id: string;
  tontine_id: string;
  tontine_name: string;
  gerance_id: string;
  gerance_name: string;
  member_id: string;
  member_name: string;
  status: string;
  terms: Record<string, number | string>;
  generated_at: string;
  signed_at: string | null;
  position_index: number | null;
  payout_date: string | null;
}

export interface MyTontine {
  tontine: Tontine;
  joined_at: string;
  position_index: number | null;
  payout_date: string | null;
  contract_status: string | null;
}

export interface DueDate {
  id: string;
  tontine_id: string;
  tontine_name: string;
  gerance_id: string;
  member_id: string;
  member_name: string;
  date: string;
  deadline_time: string;
  amount: number;
  period: number;
  status: string;
  display_status: string;
  late_days: number;
  penalty: number;
  source: string;
}

export interface Summary {
  tontine_id: string;
  tontine_name: string;
  total_days: number;
  paid_days: number;
  remaining_days: number;
  late_days_count: number;
  processing_days: number;
  total_expected: number;
  total_paid: number;
  total_remaining: number;
  penalties: number;
  progress: number;
  next_due_date: string | null;
}

export interface Payment {
  id: string;
  tontine_id: string;
  tontine_name: string;
  gerance_id: string;
  gerance_name: string;
  member_id: string;
  member_name: string;
  amount: number;
  contribution_amount: number;
  penalty_amount: number;
  days: string[];
  method: string;
  status: string;
  proof_filename: string;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
}

export interface Payout {
  id: string;
  tontine_id: string;
  tontine_name: string;
  gerance_id: string;
  gerance_name: string;
  member_id: string;
  member_name: string;
  position_index: number;
  payout_date: string;
  amount: number;
  confirmed_by_name: string;
  status: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  gerance_id: string | null;
  tontine_id: string | null;
  event: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface PaymentMethod {
  code: string;
  label: string;
  emoji: string;
  available: boolean;
}

export interface PaymentMethodsResponse {
  methods: PaymentMethod[];
  wave_number: string;
}

export interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  identity_status: string;
  tontine_count: number;
}

export interface AuditRow {
  id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  entity: string;
  entity_id: string;
  gerance_id: string | null;
  created_at: string;
}

export interface TontineMemberRow {
  member_id: string;
  name: string;
  phone: string;
  status: string;
  joined_at: string;
}

export const fcfa = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} FCFA`;

export const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  pending_validation: "En attente de validation",
  open: "Ouverte",
  running: "En cours",
  finished: "Terminée",
  suspended: "Suspendue",
  cancelled: "Annulée",
  pending: "En attente",
  checking: "En cours de vérification",
  accepted: "Acceptée",
  rejected: "Refusée",
  to_correct: "À corriger",
  cancelled_request: "Annulée",
  paid: "Payé",
  processing: "En attente de vérification",
  late: "En retard",
  due_today: "À payer aujourd'hui",
  validated: "Validé",
  to_sign: "À signer",
  signed: "Signé",
  received: "Reçue",
  active: "Actif",
  assigned: "Attribuée",
  verified: "Vérifiée",
  none: "Non fournie",
};

export const label = (key: string) => STATUS_LABELS[key] ?? key;

export const PERMISSION_LABELS: Record<string, string> = {
  create_tontine: "Créer une tontine",
  edit_tontine: "Modifier une tontine",
  manage_members: "Gérer les membres",
  invite_members: "Inviter des membres",
  manage_requests: "Gérer les demandes d'adhésion",
  verify_identity: "Vérifier les identités",
  manage_contracts: "Gérer les contrats",
  view_contributions: "Consulter les cotisations",
  record_history: "Enregistrer des données historiques",
  verify_payments: "Vérifier les paiements",
  manage_penalties: "Gérer les pénalités",
  manage_positions: "Gérer les positions",
  confirm_payouts: "Confirmer les prises",
  send_notifications: "Envoyer des notifications",
};
