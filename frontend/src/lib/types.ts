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
  grace_days: number | null;
  total_branches: number | null;
  allow_multi_branch: boolean;
  max_branches_per_member: number;
  penalty_mode: string;
  turn_mode: string;
  payment_method_ids: string[];
  branches_used: number;
  branches_available: number;
}

export interface EditImpact {
  old_dates: string[];
  new_dates: string[];
  received_positions: number;
  locked_days: number;
  old_duration_days: number;
  new_duration_days: number;
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
  branches: number;
  daily_total: number;
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
  branches: number;
  daily_total: number;
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
  method_name: string;
  method_number: string;
  reference: string;
  receipt_number: string | null;
  status: string;
  proof_filename: string;
  source: string;
  note: string | null;
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
  source: string;
  receipt_number: string | null;
  note: string | null;
  created_at: string;
}

export interface ArrearsExport {
  filename: string;
  content_base64: string;
  rows: number;
}

export interface RemindResult {
  ok: boolean;
  late_days: number;
  total_due: number;
  message: string;
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

export interface MemberFilePosition {
  id: string;
  position_index: number;
  payout_date: string;
  branch_number: number;
  status: string;
}

export interface MemberFileTontine {
  tontine_id: string;
  tontine_name: string;
  branches: number;
  daily_amount: number;
  position_index: number | null;
  payout_date: string | null;
  positions: MemberFilePosition[];
  available_positions: MemberFilePosition[];
  contract_status: string | null;
}

export interface MemberFile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: string;
  address: string | null;
  extra_info: string | null;
  tontines: MemberFileTontine[];
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
  branches: number;
  joined_at: string;
}

export interface Invitation {
  id: string;
  token: string;
  invite_path: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  role: string;
  gerance_id: string;
  gerance_name: string;
  tontine_id: string | null;
  tontine_name: string | null;
  status: string;
  created_at: string;
  accepted_at: string | null;
}

export interface PublicInvitation {
  first_name: string;
  last_name: string;
  email: string;
  gerance_name: string;
  tontine_name: string | null;
  status: string;
}

export interface PlatformSettings {
  name: string;
  slogan: string;
  logo: string | null;
  whatsapp: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  language: string;
  contact_note: string;
}

export interface FinanceRules {
  deadline_time: string;
  penalty_per_day: number;
  grace_days: number;
  replacement_after_days: number;
  allow_advance: boolean;
  advance_max_days: number;
  fees_note: string;
  refund_note: string;
}

export interface GeranceMethod {
  id: string;
  gerance_id: string;
  name: string;
  code: string;
  number: string;
  holder: string;
  icon: string;
  active: boolean;
  instructions: string;
  sort_order: number;
}

export interface MemberMethod {
  id: string;
  name: string;
  code: string;
  number: string;
  holder: string;
  icon: string;
  instructions: string;
}

export interface ArrearRow {
  member_id: string;
  member_name: string;
  member_phone: string;
  tontine_id: string;
  tontine_name: string;
  gerance_id: string;
  gerance_name: string;
  late_days: number;
  late_amount: number;
  penalties: number;
  total_due: number;
  oldest_unpaid: string;
  paid_days: number;
  total_days: number;
}

export interface ImportRow {
  line: number;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  message: string;
}

export interface ImportResult {
  tontine_name: string;
  created: number;
  enrolled: number;
  skipped: number;
  rows: ImportRow[];
}

export interface PaymentProof {
  proof_image: string;
  proof_filename: string;
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
  sent: "Invitation envoyée",
  member: "Membre",
  manager: "Gérant",
  admin: "Administrateur",
  created: "Compte créé",
  enrolled: "Rattaché",
  skipped: "Ignoré",
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
