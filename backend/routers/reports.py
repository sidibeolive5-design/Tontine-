"""Bilan hebdomadaire d'une gérance : encaissements, retards et prises à venir."""

from datetime import timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from lib.auth import require_staff
from lib.core import effective_status, penalty_amount
from lib.dates import today_iso
from lib.db import db


router = APIRouter()


class WeeklyReport(BaseModel):
    gerance_id: str
    gerance_name: str
    period_start: str
    period_end: str
    tontines: int
    active_members: int
    collected_week: int
    payments_validated: int
    payments_pending: int
    late_members: int
    late_amount: int
    penalties: int
    total_due: int
    upcoming_payouts: list[dict[str, Any]] = []
    top_arrears: list[dict[str, Any]] = []


def _fcfa(n: int) -> str:
    return f"{int(n):,}".replace(",", " ") + " FCFA"


async def build_weekly_report(gerance_id: str) -> WeeklyReport:
    from lib.core import parse_date

    gerance = await db.gerances.find_one({"id": gerance_id}, {"_id": 0}) or {}
    today = today_iso()
    start = (parse_date(today) - timedelta(days=7)).isoformat()
    horizon = (parse_date(today) + timedelta(days=7)).isoformat()

    tontine_ids: list[str] = []
    penalty_by_tontine: dict[str, int] = {}
    tontine_names: dict[str, str] = {}
    async for t in db.tontines.find({"gerance_id": gerance_id}, {"_id": 0}):
        tontine_ids.append(t["id"])
        penalty_by_tontine[t["id"]] = int(t.get("penalty_per_day", 500))
        tontine_names[t["id"]] = t["name"]

    payments = await db.payments.find({"gerance_id": gerance_id}, {"_id": 0, "proof_image": 0}).to_list(20000)
    week_validated = [
        p for p in payments
        if p["status"] == "validated" and str((p.get("decided_at") or p["created_at"]))[:10] >= start
    ]
    collected = sum(int(p["amount"]) for p in week_validated)

    dues = await db.contribution_due_dates.find({"gerance_id": gerance_id}, {"_id": 0}).to_list(50000)
    buckets: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for d in dues:
        buckets.setdefault((d["member_id"], d["tontine_id"]), []).append(d)
    arrears: list[dict[str, Any]] = []
    for (member_id, tid), items in buckets.items():
        late = [i for i in items if effective_status(i, today) == "late"]
        if not late:
            continue
        u = await db.users.find_one({"id": member_id}, {"_id": 0, "first_name": 1, "last_name": 1})
        pen = sum(penalty_amount(i, today, penalty_by_tontine.get(tid, 500)) for i in late)
        amount = sum(i["amount"] for i in late)
        arrears.append({
            "member_name": f"{u['first_name']} {u['last_name']}" if u else "—",
            "tontine_name": tontine_names.get(tid, "—"),
            "late_days": len(late),
            "total_due": amount + pen,
            "penalties": pen,
            "late_amount": amount,
        })
    arrears.sort(key=lambda r: r["total_due"], reverse=True)

    upcoming = await db.positions.find(
        {"gerance_id": gerance_id, "payout_date": {"$gte": today, "$lte": horizon}}, {"_id": 0}
    ).sort("payout_date", 1).to_list(100)
    upcoming_out = []
    for p in upcoming:
        if p.get("status") == "received":
            continue
        name = "— non attribuée —"
        if p.get("member_id"):
            u = await db.users.find_one({"id": p["member_id"]}, {"_id": 0})
            name = f"{u['first_name']} {u['last_name']}" if u else name
        upcoming_out.append({
            "tontine_name": tontine_names.get(p["tontine_id"], "—"),
            "position_index": p["index"],
            "payout_date": p["payout_date"],
            "member_name": name,
        })

    return WeeklyReport(
        gerance_id=gerance_id,
        gerance_name=gerance.get("name", "—"),
        period_start=start,
        period_end=today,
        tontines=len(tontine_ids),
        active_members=len(await db.tontine_members.distinct("member_id", {"gerance_id": gerance_id,
                                                                           "status": "active"})),
        collected_week=collected,
        payments_validated=len(week_validated),
        payments_pending=len([p for p in payments if p["status"] == "pending"]),
        late_members=len({(a["member_name"], a["tontine_name"]) for a in arrears}),
        late_amount=sum(a["late_amount"] for a in arrears),
        penalties=sum(a["penalties"] for a in arrears),
        total_due=sum(a["total_due"] for a in arrears),
        upcoming_payouts=upcoming_out[:20],
        top_arrears=arrears[:10],
    )


def report_message(r: WeeklyReport) -> str:
    lines = [
        f"Bilan du {r.period_start} au {r.period_end} — {r.gerance_name}",
        f"• Encaissé cette semaine : {_fcfa(r.collected_week)} ({r.payments_validated} paiement(s) validé(s))",
        f"• Paiements encore à vérifier : {r.payments_pending}",
        f"• Retards : {r.late_members} situation(s), {_fcfa(r.total_due)} dus dont {_fcfa(r.penalties)} de pénalités",
        f"• Tontines suivies : {r.tontines} · membres actifs : {r.active_members}",
    ]
    if r.upcoming_payouts:
        lines.append("• Prises des 7 prochains jours :")
        for p in r.upcoming_payouts[:5]:
            lines.append(
                f"   – {p['payout_date']} · {p['tontine_name']} · position {p['position_index']} · {p['member_name']}"
            )
    else:
        lines.append("• Aucune prise prévue dans les 7 prochains jours.")
    if r.top_arrears:
        lines.append("• Principaux retards :")
        for a in r.top_arrears[:5]:
            lines.append(
                f"   – {a['member_name']} ({a['tontine_name']}) : {a['late_days']} jour(s), {_fcfa(a['total_due'])}"
            )
    return "\n".join(lines)


@router.get("/reports/weekly", response_model=WeeklyReport)
async def weekly_report(user: dict[str, Any] = Depends(require_staff), gerance_id: Optional[str] = None):
    """Same figures as the Monday email, on demand in the interface."""
    target = gerance_id if (user["role"] == "admin" and gerance_id) else user.get("gerance_id")
    if not target:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Aucune gérance rattachée à ce compte")
    if user["role"] != "admin" and target != user.get("gerance_id"):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Cette gérance n'est pas la vôtre")
    return await build_weekly_report(target)
