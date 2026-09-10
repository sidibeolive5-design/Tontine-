from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from lib.auth import current_user, ensure_permission, require_staff
from lib.pdf import build_receipt, fcfa, receipt_datetime
from lib.core import (
    assert_gerance_access,
    audit,
    effective_status,
    get_tontine,
    late_days,
    new_id,
    notify,
    now_utc,
    parse_date,
    penalty_amount,
)
from lib.dates import today_iso
from lib.db import db

router = APIRouter()

PAYMENT_METHODS = [
    {"code": "wave", "label": "Wave", "emoji": "🌊", "available": True},
    {"code": "orange", "label": "Orange Money", "emoji": "🟠", "available": False},
    {"code": "mtn", "label": "MTN Money", "emoji": "🟡", "available": False},
    {"code": "moov", "label": "Moov Money", "emoji": "🔵", "available": False},
    {"code": "bank", "label": "Virement bancaire", "emoji": "🏦", "available": False},
]

WAVE_NUMBER = "+225 07 00 00 00 00"


class DueDateOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    member_id: str
    member_name: str
    date: str
    deadline_time: str
    amount: int
    period: int
    status: str
    display_status: str
    late_days: int
    penalty: int
    source: str


class SummaryOut(BaseModel):
    tontine_id: str
    tontine_name: str
    total_days: int
    paid_days: int
    remaining_days: int
    late_days_count: int
    processing_days: int
    total_expected: int
    total_paid: int
    total_remaining: int
    penalties: int
    progress: int
    next_due_date: Optional[str] = None


async def _grace_for(tontine: dict[str, Any]) -> int:
    """Tontine override first, then the gérance rule, then 0 (penalty from day after)."""
    if tontine.get("grace_days") is not None:
        return int(tontine["grace_days"])
    from routers.settings import finance_rules_for

    rules = await finance_rules_for(tontine["gerance_id"])
    return int(rules.get("grace_days", 0))


async def _due_rows(query: dict[str, Any]) -> list[DueDateOut]:
    rows = await db.contribution_due_dates.find(query, {"_id": 0}).sort("date", 1).to_list(20000)
    today = today_iso()
    names: dict[str, str] = {}
    tnames: dict[str, str] = {}
    tpenalty: dict[str, int] = {}
    tgrace: dict[str, int] = {}
    tmode: dict[str, str] = {}
    out = []
    for r in rows:
        if r["member_id"] not in names:
            u = await db.users.find_one({"id": r["member_id"]}, {"_id": 0})
            names[r["member_id"]] = f"{u['first_name']} {u['last_name']}" if u else "—"
        if r["tontine_id"] not in tnames:
            t = await db.tontines.find_one({"id": r["tontine_id"]}, {"_id": 0})
            tnames[r["tontine_id"]] = t["name"] if t else "—"
            tpenalty[r["tontine_id"]] = int(t.get("penalty_per_day", 500)) if t else 500
            tgrace[r["tontine_id"]] = await _grace_for(t) if t else 0
            tmode[r["tontine_id"]] = (t or {}).get("penalty_mode", "member")
        base = penalty_amount(r, today, tpenalty[r["tontine_id"]], tgrace[r["tontine_id"]])
        # « Par branche » multiplies the flat penalty by the parts held (rows default to 1).
        multiplier = max(int(r.get("branches") or 1), 1) if tmode[r["tontine_id"]] == "branch" else 1
        out.append(
            DueDateOut(
                **r,
                tontine_name=tnames[r["tontine_id"]],
                member_name=names[r["member_id"]],
                display_status=effective_status(r, today),
                late_days=late_days(r, today),
                penalty=base * multiplier,
            )
        )
    return out


def _scope(user: dict[str, Any], gerance_id: Optional[str], tontine_id: Optional[str],
           member_id: Optional[str]) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if user["role"] == "member":
        query["member_id"] = user["id"]
    elif user["role"] == "manager":
        query["gerance_id"] = user.get("gerance_id")
    else:
        if gerance_id:
            query["gerance_id"] = gerance_id
    if tontine_id:
        query["tontine_id"] = tontine_id
    if member_id and user["role"] != "member":
        query["member_id"] = member_id
    return query


@router.get("/due-dates", response_model=list[DueDateOut])
async def due_dates(
    user: dict[str, Any] = Depends(current_user),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
    member_id: Optional[str] = None,
):
    return await _due_rows(_scope(user, gerance_id, tontine_id, member_id))


@router.get("/summary", response_model=list[SummaryOut])
async def summary(
    user: dict[str, Any] = Depends(current_user),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
    member_id: Optional[str] = None,
):
    rows = await _due_rows(_scope(user, gerance_id, tontine_id, member_id))
    grouped: dict[str, list[DueDateOut]] = {}
    for r in rows:
        grouped.setdefault(r.tontine_id, []).append(r)
    out = []
    for tid, items in grouped.items():
        paid = [i for i in items if i.status == "paid"]
        processing = [i for i in items if i.status == "processing"]
        late = [i for i in items if i.display_status == "late"]
        upcoming = [i for i in items if i.status == "pending" and i.display_status != "late"]
        total_expected = sum(i.amount for i in items)
        total_paid = sum(i.amount for i in paid)
        out.append(
            SummaryOut(
                tontine_id=tid,
                tontine_name=items[0].tontine_name,
                total_days=len(items),
                paid_days=len(paid),
                remaining_days=len(items) - len(paid),
                late_days_count=len(late),
                processing_days=len(processing),
                total_expected=total_expected,
                total_paid=total_paid,
                total_remaining=total_expected - total_paid,
                penalties=sum(i.penalty for i in items),
                progress=round(total_paid * 100 / total_expected) if total_expected else 0,
                next_due_date=upcoming[0].date if upcoming else None,
            )
        )
    return out


class ArrearRow(BaseModel):
    member_id: str
    member_name: str
    member_phone: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    late_days: int
    late_amount: int
    penalties: int
    total_due: int
    oldest_unpaid: str
    paid_days: int
    total_days: int


@router.get("/arrears", response_model=list[ArrearRow])
async def arrears(
    user: dict[str, Any] = Depends(require_staff),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
):
    """Members ranked by what they actually owe today — arrears + penalties."""
    query = _scope(user, gerance_id, tontine_id, None)
    rows = await db.contribution_due_dates.find(query, {"_id": 0}).to_list(50000)
    today = today_iso()
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        buckets.setdefault((r["member_id"], r["tontine_id"]), []).append(r)

    out: list[ArrearRow] = []
    for (member_id, tid), items in buckets.items():
        late = [i for i in items if effective_status(i, today) == "late"]
        if not late:
            continue
        tontine = await db.tontines.find_one({"id": tid}, {"_id": 0})
        gerance = await db.gerances.find_one({"id": items[0]["gerance_id"]}, {"_id": 0})
        member = await db.users.find_one({"id": member_id}, {"_id": 0})
        penalty_per_day = int(tontine.get("penalty_per_day", 500)) if tontine else 500
        late_amount = sum(i["amount"] for i in late)
        penalties = sum(penalty_amount(i, today, penalty_per_day) for i in late)
        out.append(
            ArrearRow(
                member_id=member_id,
                member_name=f"{member['first_name']} {member['last_name']}" if member else "—",
                member_phone=member["phone"] if member else "—",
                tontine_id=tid,
                tontine_name=tontine["name"] if tontine else "—",
                gerance_id=items[0]["gerance_id"],
                gerance_name=gerance["name"] if gerance else "—",
                late_days=len(late),
                late_amount=late_amount,
                penalties=penalties,
                total_due=late_amount + penalties,
                oldest_unpaid=min(i["date"] for i in late),
                paid_days=len([i for i in items if i["status"] == "paid"]),
                total_days=len(items),
            )
        )
    out.sort(key=lambda r: r.total_due, reverse=True)
    return out


class RemindInput(BaseModel):
    member_id: str
    tontine_id: str
    message: Optional[str] = None


@router.post("/arrears/remind")
async def remind_member(payload: RemindInput, user: dict[str, Any] = Depends(require_staff)):
    """Personalised nudge sent from the arrears table by the responsible manager."""
    ensure_permission(user, "send_notifications")
    tontine = await get_tontine(payload.tontine_id)
    assert_gerance_access(user, tontine["gerance_id"])
    member = await db.users.find_one({"id": payload.member_id, "role": "member"}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Membre introuvable")
    if not await db.tontine_members.find_one({"tontine_id": tontine["id"], "member_id": member["id"]}):
        raise HTTPException(status_code=422, detail="Ce membre n'appartient pas à cette tontine")
    today = today_iso()
    dues = await db.contribution_due_dates.find(
        {"tontine_id": tontine["id"], "member_id": member["id"], "status": "pending"}, {"_id": 0}
    ).to_list(5000)
    late = [d for d in dues if effective_status(d, today) == "late"]
    penalty_per_day = int(tontine.get("penalty_per_day", 500))
    total_due = sum(d["amount"] for d in late) + sum(penalty_amount(d, today, penalty_per_day) for d in late)
    custom = (payload.message or "").strip()
    message = (
        f"{tontine['name']} : vous avez {len(late)} jour(s) impayé(s), soit {total_due} FCFA "
        f"(pénalités incluses). Merci de régulariser votre situation."
    )
    if custom:
        message = f"{custom}\n\n{message}"
    await notify(
        member["id"],
        "Relance de votre gérance",
        message,
        tontine["gerance_id"],
        tontine["id"],
        "manual_reminder",
    )
    await audit(user, "member_reminded", "user", member["id"], tontine["gerance_id"],
                {"tontine_id": tontine["id"], "late_days": len(late), "total_due": total_due})
    return {"ok": True, "late_days": len(late), "total_due": total_due, "message": message}


class ExportOut(BaseModel):
    filename: str
    content_base64: str
    rows: int


@router.get("/arrears/export", response_model=ExportOut)
async def export_arrears(
    user: dict[str, Any] = Depends(require_staff),
    gerance_id: Optional[str] = None,
    tontine_id: Optional[str] = None,
):
    """Same data as /arrears, as a .xlsx sheet for gérance meetings."""
    import base64
    import io

    from openpyxl import Workbook

    rows = await arrears(user, gerance_id, tontine_id)
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Retards"
    headers = [
        "Rang", "Membre", "Téléphone", "Tontine", "Gérance", "Jours impayés",
        "Cotisations en retard (FCFA)", "Pénalités (FCFA)", "Total dû (FCFA)",
        "Plus ancien impayé", "Jours payés", "Jours prévus",
    ]
    ws.append(headers)
    for index, r in enumerate(rows, start=1):
        ws.append([
            index, r.member_name, r.member_phone, r.tontine_name, r.gerance_name, r.late_days,
            r.late_amount, r.penalties, r.total_due, r.oldest_unpaid, r.paid_days, r.total_days,
        ])
    ws.append([])
    ws.append(["", "TOTAL", "", "", "", sum(r.late_days for r in rows),
               sum(r.late_amount for r in rows), sum(r.penalties for r in rows),
               sum(r.total_due for r in rows)])
    for column, width in zip("ABCDEFGHIJKL", (6, 24, 16, 22, 24, 14, 26, 18, 18, 20, 12, 12)):
        ws.column_dimensions[column].width = width
    buffer = io.BytesIO()
    wb.save(buffer)
    await audit(user, "arrears_exported", "gerance", user.get("gerance_id") or "-",
                user.get("gerance_id"), {"rows": len(rows)})
    return ExportOut(
        filename=f"retards-{today_iso()}.xlsx",
        content_base64=base64.b64encode(buffer.getvalue()).decode(),
        rows=len(rows),
    )


class PaymentInput(BaseModel):
    tontine_id: str
    due_date_ids: list[str] = Field(min_length=1)
    method: str = "wave"
    proof_image: str = Field(min_length=10)  # base64 data URL of the payment receipt
    proof_filename: str = "preuve.jpg"
    reference: Optional[str] = None


class PaymentOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    member_id: str
    member_name: str
    amount: int
    contribution_amount: int
    penalty_amount: int
    days: list[str]
    method: str
    method_name: str = ""
    method_number: str = ""
    reference: str = ""
    receipt_number: Optional[str] = None
    status: str
    proof_filename: str
    created_at: Any
    decided_at: Optional[Any] = None
    decided_by_name: Optional[str] = None


async def _payment_out(p: dict[str, Any]) -> PaymentOut:
    t = await db.tontines.find_one({"id": p["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": p["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
    decider = await db.users.find_one({"id": p.get("decided_by")}, {"_id": 0}) if p.get("decided_by") else None
    body = {k: v for k, v in p.items() if k not in ("proof_image", "decided_by")}
    return PaymentOut(
        **body,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        decided_by_name=f"{decider['first_name']} {decider['last_name']}" if decider else None,
    )


@router.get("/payment-methods")
async def payment_methods():
    return {"methods": PAYMENT_METHODS, "wave_number": WAVE_NUMBER}


@router.post("/payments", response_model=PaymentOut)
async def submit_payment(payload: PaymentInput, user: dict[str, Any] = Depends(current_user)):
    tontine = await get_tontine(payload.tontine_id)
    # Methods come from the gérance settings; the legacy Wave entry is the fallback
    # so tontines created before the settings centre keep working unchanged.
    query: dict[str, Any] = {"gerance_id": tontine["gerance_id"], "active": True}
    selected = tontine.get("payment_method_ids")
    if selected:
        query["id"] = {"$in": selected}
    configured = await db.payment_methods.find(query, {"_id": 0}).to_list(100)
    chosen_method: Optional[dict[str, Any]] = None
    if configured:
        chosen_method = next((m for m in configured if m["code"] == payload.method.lower()), None)
        if not chosen_method:
            raise HTTPException(status_code=400, detail="Ce moyen de paiement n'est pas disponible pour cette tontine")
    else:
        legacy = next((m for m in PAYMENT_METHODS if m["code"] == payload.method), None)
        if not legacy or not legacy["available"]:
            raise HTTPException(status_code=400, detail="Ce moyen de paiement n'est pas encore disponible")
        chosen_method = {"name": legacy["label"], "code": legacy["code"], "number": WAVE_NUMBER}
    dues = await db.contribution_due_dates.find(
        {"id": {"$in": payload.due_date_ids}, "member_id": user["id"], "tontine_id": tontine["id"]}, {"_id": 0}
    ).to_list(500)
    if len(dues) != len(payload.due_date_ids):
        raise HTTPException(status_code=422, detail="Certaines échéances sélectionnées sont invalides")
    if any(d["status"] in ("paid", "processing") for d in dues):
        raise HTTPException(status_code=409, detail="Certaines échéances sont déjà payées ou en cours de vérification")
    today = today_iso()
    grace = await _grace_for(tontine)
    per_branch = tontine.get("penalty_mode") == "branch"
    # Amount is computed server-side: the member never types it.
    contribution_amount = sum(d["amount"] for d in dues)
    penalty_total = sum(
        penalty_amount(d, today, int(tontine.get("penalty_per_day", 500)), grace)
        * (max(int(d.get("branches") or 1), 1) if per_branch else 1)
        for d in dues
    )
    payment = {
        "id": new_id(),
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": user["id"],
        "amount": contribution_amount + penalty_total,
        "contribution_amount": contribution_amount,
        "penalty_amount": penalty_total,
        "days": sorted(d["date"] for d in dues),
        "due_date_ids": payload.due_date_ids,
        "method": payload.method,
        # Snapshot so a deleted/renamed method never rewrites payment history.
        "method_name": chosen_method["name"],
        "method_number": chosen_method.get("number", ""),
        "reference": payload.reference or "",
        "status": "pending",  # never auto-confirmed: a human verifies the receipt
        "proof_image": payload.proof_image,
        "proof_filename": payload.proof_filename,
        "receipt_number": None,
        "created_at": now_utc(),
        "decided_at": None,
        "decided_by": None,
    }
    await db.payments.insert_one(payment)
    await db.contribution_due_dates.update_many(
        {"id": {"$in": payload.due_date_ids}},
        {"$set": {"status": "processing", "payment_id": payment["id"], "synced_at": now_utc()}},
    )
    await notify(
        user["id"],
        "Preuve reçue",
        f"Votre paiement de {payment['amount']} FCFA est en attente de vérification.",
        tontine["gerance_id"],
        tontine["id"],
        "payment_submitted",
    )
    gerance = await db.gerances.find_one({"id": tontine["gerance_id"]}, {"_id": 0})
    if gerance:
        await notify(
            gerance["owner_id"],
            "Paiement à vérifier",
            f"{user['first_name']} {user['last_name']} a envoyé une preuve de {payment['amount']} FCFA.",
            tontine["gerance_id"],
            tontine["id"],
            "payment_submitted",
        )
    await audit(user, "payment_submitted", "payment", payment["id"], tontine["gerance_id"])
    payment.pop("_id", None)
    return await _payment_out(payment)


@router.get("/payments", response_model=list[PaymentOut])
async def list_payments(
    user: dict[str, Any] = Depends(current_user),
    gerance_id: Optional[str] = None,
    status: Optional[str] = None,
):
    query = _scope(user, gerance_id, None, None)
    if status:
        query["status"] = status
    rows = await db.payments.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [await _payment_out(p) for p in rows]


@router.get("/payments/{payment_id}/proof")
async def payment_proof(payment_id: str, user: dict[str, Any] = Depends(current_user)):
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    if user["role"] == "member" and p["member_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Preuve privée")
    if user["role"] == "manager":
        assert_gerance_access(user, p["gerance_id"])
    return {"proof_image": p["proof_image"], "proof_filename": p["proof_filename"]}


async def _platform_identity() -> dict[str, Any]:
    doc = await db.platform_settings.find_one({"id": "platform"}, {"_id": 0}) or {}
    return {
        "name": doc.get("name") or "AIDONS-NOUS VIVANTS",
        "tagline": doc.get("slogan") or "Cotiser ensemble, recevoir sereinement.",
        "logo": doc.get("logo"),
        "phone": doc.get("phone"),
        "whatsapp": doc.get("whatsapp"),
        "email": doc.get("email"),
    }


def _assert_receipt_access(doc: dict[str, Any], user: dict[str, Any]) -> None:
    if user["role"] == "member" and doc["member_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Reçu privé")
    if user["role"] == "manager":
        assert_gerance_access(user, doc["gerance_id"])


def _pdf_response(content: bytes, filename: str) -> Response:
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/payments/{payment_id}/receipt.pdf")
async def payment_receipt_pdf(payment_id: str, user: dict[str, Any] = Depends(current_user)):
    """Printable receipt — only for a payment a human has actually validated."""
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    _assert_receipt_access(p, user)
    if p["status"] != "validated":
        raise HTTPException(status_code=409, detail="Le reçu est disponible une fois le paiement validé")
    t = await db.tontines.find_one({"id": p["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": p["gerance_id"]}, {"_id": 0})
    m = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
    decider = await db.users.find_one({"id": p.get("decided_by")}, {"_id": 0}) if p.get("decided_by") else None
    days = p.get("days") or []
    rows = [
        ("Membre", f"{m['first_name']} {m['last_name']}" if m else "—"),
        ("Téléphone", (m or {}).get("phone") or "—"),
        ("Tontine", (t or {}).get("name") or "—"),
        ("Gérance", (g or {}).get("name") or "—"),
        ("Jours réglés", f"{len(days)} jour(s) : " + ", ".join(days) if days else "—"),
        ("Cotisations", fcfa(p.get("contribution_amount", p["amount"]))),
        ("Pénalités", fcfa(p.get("penalty_amount", 0))),
        ("Moyen de paiement", p.get("method_name") or p.get("method") or "—"),
        ("Numéro / référence", " · ".join([v for v in (p.get("method_number"), p.get("reference")) if v]) or "—"),
        ("Preuve reçue le", receipt_datetime(p.get("created_at"))),
        ("Validé le", receipt_datetime(p.get("decided_at"))),
        ("Validé par", f"{decider['first_name']} {decider['last_name']}" if decider else "—"),
    ]
    pdf = build_receipt(
        platform=await _platform_identity(),
        kind="payment",
        receipt_number=p.get("receipt_number") or p["id"][:8].upper(),
        rows=rows,
        total_label="Montant total réglé",
        total_value=fcfa(p["amount"]),
        footer_note=(
            "Ce reçu atteste l'enregistrement des jours de cotisation listés ci-dessus. "
            "Conservez-le : il fait foi auprès de votre gérance en cas de contestation."
        ),
    )
    return _pdf_response(pdf, f"recu-cotisation-{p.get('receipt_number') or p['id'][:8]}.pdf")


@router.get("/payouts/{payout_id}/receipt.pdf")
async def payout_receipt_pdf(payout_id: str, user: dict[str, Any] = Depends(current_user)):
    p = await db.payouts.find_one({"id": payout_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Prise introuvable")
    _assert_receipt_access(p, user)
    number = p.get("receipt_number")
    if not number:
        # Payouts confirmed before receipts existed get their number on first download.
        number = await _next_payout_receipt_number(p["gerance_id"])
        await db.payouts.update_one({"id": payout_id}, {"$set": {"receipt_number": number}})
    t = await db.tontines.find_one({"id": p["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": p["gerance_id"]}, {"_id": 0})
    m = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
    c = await db.users.find_one({"id": p.get("confirmed_by")}, {"_id": 0}) if p.get("confirmed_by") else None
    historical = str(p.get("source", "")).startswith("historique")
    rows = [
        ("Bénéficiaire", f"{m['first_name']} {m['last_name']}" if m else "—"),
        ("Téléphone", (m or {}).get("phone") or "—"),
        ("Tontine", (t or {}).get("name") or "—"),
        ("Gérance", (g or {}).get("name") or "—"),
        ("Position", f"Position {p.get('position_index', '—')}"),
        ("Date de la prise", p.get("payout_date") or "—"),
        ("Statut", "Prise reçue"),
        ("Confirmé par", f"{c['first_name']} {c['last_name']}" if c else "—"),
        ("Enregistré le", receipt_datetime(p.get("created_at"))),
    ]
    if p.get("note"):
        rows.append(("Note", str(p["note"])))
    pdf = build_receipt(
        platform=await _platform_identity(),
        kind="payout",
        receipt_number=number,
        rows=rows,
        total_label="Montant de la prise",
        total_value=fcfa(p["amount"]),
        footer_note=(
            "Ce reçu est émis après confirmation réelle de la remise de la prise au bénéficiaire "
            "par le responsable de la gérance."
        ),
        watermark=(
            "Historique enregistré par l'"
            + ("administrateur" if p.get("source") == "historique_administrateur" else "gérant")
            if historical
            else None
        ),
    )
    return _pdf_response(pdf, f"recu-prise-{number}.pdf")


async def _next_payout_receipt_number(gerance_id: str) -> str:
    seq = await db.payouts.count_documents({"gerance_id": gerance_id, "receipt_number": {"$ne": None}}) + 1
    return f"ANV-P-{now_utc().year}-{seq:05d}"


class DecidePayment(BaseModel):
    action: str  # validate | reject
    reason: Optional[str] = None


@router.post("/payments/{payment_id}/decide", response_model=PaymentOut)
async def decide_payment(payment_id: str, payload: DecidePayment, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "verify_payments")
    p = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Paiement introuvable")
    assert_gerance_access(user, p["gerance_id"])
    if p["status"] != "pending":
        raise HTTPException(status_code=409, detail="Ce paiement a déjà été traité")
    tontine = await get_tontine(p["tontine_id"])
    if payload.action == "validate":
        year = now_utc().year
        seq = await db.payments.count_documents(
            {"gerance_id": p["gerance_id"], "status": "validated"}
        ) + 1
        receipt_number = f"ANV-{year}-{seq:05d}"
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {"status": "validated", "decided_at": now_utc(), "decided_by": user["id"],
                      "receipt_number": receipt_number}},
        )
        await db.contribution_due_dates.update_many(
            {"id": {"$in": p["due_date_ids"]}},
            {"$set": {"status": "paid", "paid_at": now_utc(), "synced_at": now_utc()}},
        )
        await notify(
            p["member_id"],
            "Paiement validé ✅",
            f"Votre paiement de {p['amount']} FCFA pour la tontine {tontine['name']} a été vérifié et validé. "
            f"Les {len(p['days'])} jours concernés sont maintenant enregistrés comme payés.",
            p["gerance_id"],
            p["tontine_id"],
            "payment_validated",
        )
    elif payload.action == "reject":
        await db.payments.update_one(
            {"id": payment_id},
            {"$set": {"status": "rejected", "decided_at": now_utc(), "decided_by": user["id"],
                      "reason": payload.reason}},
        )
        await db.contribution_due_dates.update_many(
            {"id": {"$in": p["due_date_ids"]}},
            {"$set": {"status": "pending", "payment_id": None, "synced_at": now_utc()}},
        )
        await notify(
            p["member_id"],
            "Paiement rejeté ⚠️",
            "Votre preuve de paiement n'a pas pu être validée. Veuillez vérifier votre paiement et "
            "soumettre une nouvelle preuve.",
            p["gerance_id"],
            p["tontine_id"],
            "payment_rejected",
        )
    else:
        raise HTTPException(status_code=422, detail="Action invalide")
    await audit(user, f"payment_{payload.action}", "payment", payment_id, p["gerance_id"])
    fresh = await db.payments.find_one({"id": payment_id}, {"_id": 0})
    assert fresh is not None
    return await _payment_out(fresh)


class ManualDue(BaseModel):
    due_date_id: str
    status: str  # paid | pending
    note: Optional[str] = None


@router.post("/due-dates/manual")
async def manual_due(payload: ManualDue, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "record_history")
    if payload.status not in ("paid", "pending"):
        raise HTTPException(status_code=422, detail="Statut invalide")
    due = await db.contribution_due_dates.find_one({"id": payload.due_date_id}, {"_id": 0})
    if not due:
        raise HTTPException(status_code=404, detail="Échéance introuvable")
    assert_gerance_access(user, due["gerance_id"])
    label = "administrateur" if user["role"] == "admin" else "gérant"
    await db.contribution_due_dates.update_one(
        {"id": payload.due_date_id},
        {"$set": {"status": payload.status, "source": f"historique_{label}", "synced_at": now_utc(),
                  "note": payload.note}},
    )
    await audit(user, "due_date_manual", "contribution_due_date", payload.due_date_id, due["gerance_id"],
                {"status": payload.status})
    return {"ok": True, "status": payload.status, "source": f"historique_{label}"}


class PayoutInput(BaseModel):
    position_id: str


class PayoutOut(BaseModel):
    id: str
    tontine_id: str
    tontine_name: str
    gerance_id: str
    gerance_name: str
    member_id: str
    member_name: str
    position_index: int
    payout_date: str
    amount: int
    confirmed_by_name: str
    status: str
    source: str = "confirmation"
    receipt_number: Optional[str] = None
    note: Optional[str] = None
    created_at: Any


@router.post("/payouts/confirm", response_model=PayoutOut)
async def confirm_payout(payload: PayoutInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "confirm_payouts")
    pos = await db.positions.find_one({"id": payload.position_id}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="Position introuvable")
    assert_gerance_access(user, pos["gerance_id"])
    if not pos.get("member_id"):
        raise HTTPException(status_code=400, detail="Aucun membre attribué à cette position")
    if await db.payouts.find_one({"position_id": pos["id"]}):
        raise HTTPException(status_code=409, detail="Prise déjà confirmée pour cette position")
    tontine = await get_tontine(pos["tontine_id"])
    doc = {
        "id": new_id(),
        "position_id": pos["id"],
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": pos["member_id"],
        "position_index": pos["index"],
        "payout_date": pos["payout_date"],
        "amount": int(tontine["payout_amount"]),
        "confirmed_by": user["id"],
        "status": "received",
        "source": "confirmation",
        "receipt_number": await _next_payout_receipt_number(tontine["gerance_id"]),
        "created_at": now_utc(),
    }
    await db.payouts.insert_one(doc)
    await db.positions.update_one({"id": pos["id"]}, {"$set": {"status": "received"}})
    await notify(
        pos["member_id"],
        "Prise confirmée 🎉",
        f"Votre prise de {doc['amount']} FCFA pour {tontine['name']} a été confirmée. Votre reçu est disponible.",
        tontine["gerance_id"],
        tontine["id"],
        "payout_confirmed",
    )
    await audit(user, "payout_confirmed", "payout", doc["id"], tontine["gerance_id"])
    doc.pop("_id", None)
    return await _payout_out(doc, user)


async def _payout_out(p: dict[str, Any], decider: Optional[dict[str, Any]] = None) -> PayoutOut:
    t = await db.tontines.find_one({"id": p["tontine_id"]}, {"_id": 0})
    g = await db.gerances.find_one({"id": p["gerance_id"]}, {"_id": 0})
    u = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
    c = decider or await db.users.find_one({"id": p["confirmed_by"]}, {"_id": 0})
    body = {k: v for k, v in p.items() if k not in ("position_id", "confirmed_by")}
    return PayoutOut(
        **body,
        tontine_name=t["name"] if t else "—",
        gerance_name=g["name"] if g else "—",
        member_name=f"{u['first_name']} {u['last_name']}" if u else "—",
        confirmed_by_name=f"{c['first_name']} {c['last_name']}" if c else "—",
    )


class HistoricalPayoutInput(BaseModel):
    position_id: str
    payout_date: str
    amount: Optional[int] = None
    note: Optional[str] = None


@router.post("/payouts/historical", response_model=PayoutOut)
async def record_historical_payout(
    payload: HistoricalPayoutInput, user: dict[str, Any] = Depends(require_staff)
):
    """A prise already handed over before the tontine arrived on the platform."""
    ensure_permission(user, "record_history")
    pos = await db.positions.find_one({"id": payload.position_id}, {"_id": 0})
    if not pos:
        raise HTTPException(status_code=404, detail="Position introuvable")
    assert_gerance_access(user, pos["gerance_id"])
    if not pos.get("member_id"):
        raise HTTPException(status_code=400, detail="Attribuez d'abord un membre à cette position")
    if await db.payouts.find_one({"position_id": pos["id"]}):
        raise HTTPException(status_code=409, detail="Une prise est déjà enregistrée pour cette position")
    try:
        parse_date(payload.payout_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Date invalide (format AAAA-MM-JJ)")
    tontine = await get_tontine(pos["tontine_id"])
    label = "administrateur" if user["role"] == "admin" else "gérant"
    doc = {
        "id": new_id(),
        "position_id": pos["id"],
        "tontine_id": tontine["id"],
        "gerance_id": tontine["gerance_id"],
        "member_id": pos["member_id"],
        "position_index": pos["index"],
        "payout_date": payload.payout_date,
        "amount": int(payload.amount) if payload.amount else int(tontine["payout_amount"]),
        "confirmed_by": user["id"],
        "status": "received",
        "source": f"historique_{label}",
        "receipt_number": await _next_payout_receipt_number(tontine["gerance_id"]),
        "note": payload.note,
        "created_at": now_utc(),
    }
    await db.payouts.insert_one(doc)
    await db.positions.update_one({"id": pos["id"]}, {"$set": {"status": "received"}})
    await notify(
        pos["member_id"],
        "Prise historique enregistrée",
        f"Historique enregistré par l'{label} : votre prise de {doc['amount']} FCFA pour "
        f"{tontine['name']} (position {pos['index']}, {payload.payout_date}) a été enregistrée.",
        tontine["gerance_id"],
        tontine["id"],
        "payout_historical",
    )
    await audit(user, "payout_historical", "payout", doc["id"], tontine["gerance_id"],
                {"payout_date": payload.payout_date, "amount": doc["amount"]})
    doc.pop("_id", None)
    return await _payout_out(doc, user)


@router.get("/payouts", response_model=list[PayoutOut])
async def list_payouts(user: dict[str, Any] = Depends(current_user), gerance_id: Optional[str] = None):
    query = _scope(user, gerance_id, None, None)
    rows = await db.payouts.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [await _payout_out(p) for p in rows]
