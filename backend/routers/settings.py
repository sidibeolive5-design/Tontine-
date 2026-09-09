"""Settings centre: platform identity, per-gérance payment methods and financial rules.

Nothing here is hardcoded in the UI: every value is read from Mongo with a safe
fallback, so existing tontines keep working even before any setting is saved.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from lib.auth import ensure_permission, optional_user, require_admin, require_staff
from lib.core import assert_gerance_access, audit, get_tontine, new_id, now_utc
from lib.db import db

router = APIRouter()

PLATFORM_DEFAULTS: dict[str, Any] = {
    "name": "AIDONS-NOUS VIVANTS",
    "slogan": "Cotiser ensemble, recevoir sereinement.",
    "logo": None,
    "whatsapp": "",
    "phone": "",
    "email": "",
    "address": "",
    "currency": "FCFA",
    "language": "fr",
    "contact_note": "",
}

FINANCE_DEFAULTS: dict[str, Any] = {
    "deadline_time": "18:00",
    "penalty_per_day": 500,
    "grace_days": 0,          # 0 = pénalité dès le lendemain de l'échéance
    "replacement_after_days": 15,
    "allow_advance": True,
    "advance_max_days": 30,
    "fees_note": "",
    "refund_note": "",
}


class PlatformSettings(BaseModel):
    name: str = Field(min_length=2)
    slogan: str = ""
    logo: Optional[str] = None
    whatsapp: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    currency: str = "FCFA"
    language: str = "fr"
    contact_note: str = ""


@router.get("/settings/platform", response_model=PlatformSettings)
async def read_platform_settings(_: Optional[dict[str, Any]] = Depends(optional_user)):
    doc = await db.platform_settings.find_one({"id": "platform"}, {"_id": 0})
    return PlatformSettings(**{**PLATFORM_DEFAULTS, **{k: v for k, v in (doc or {}).items() if k != "id"}})


@router.put("/settings/platform", response_model=PlatformSettings)
async def update_platform_settings(payload: PlatformSettings, admin: dict[str, Any] = Depends(require_admin)):
    await db.platform_settings.update_one(
        {"id": "platform"}, {"$set": {**payload.model_dump(), "updated_at": now_utc()}}, upsert=True
    )
    await audit(admin, "platform_settings_updated", "settings", "platform", None,
                {"name": payload.name, "currency": payload.currency})
    return payload


class FinanceRules(BaseModel):
    deadline_time: str = "18:00"
    penalty_per_day: int = Field(default=500, ge=0)
    grace_days: int = Field(default=0, ge=0)
    replacement_after_days: int = Field(default=15, ge=0)
    allow_advance: bool = True
    advance_max_days: int = Field(default=30, ge=1)
    fees_note: str = ""
    refund_note: str = ""


def _scoped_gerance(user: dict[str, Any], gerance_id: Optional[str]) -> str:
    """A manager is always pinned to his own gérance; only the admin may target another."""
    if user["role"] == "admin" and gerance_id:
        return gerance_id
    own = user.get("gerance_id")
    if not own:
        raise HTTPException(status_code=400, detail="Aucune gérance rattachée à ce compte")
    return own


async def finance_rules_for(gerance_id: str) -> dict[str, Any]:
    doc = await db.finance_rules.find_one({"gerance_id": gerance_id}, {"_id": 0})
    return {**FINANCE_DEFAULTS, **{k: v for k, v in (doc or {}).items() if k != "gerance_id"}}


@router.get("/settings/finance", response_model=FinanceRules)
async def read_finance_rules(user: dict[str, Any] = Depends(require_staff), gerance_id: Optional[str] = None):
    return FinanceRules(**await finance_rules_for(_scoped_gerance(user, gerance_id)))


@router.put("/settings/finance", response_model=FinanceRules)
async def update_finance_rules(
    payload: FinanceRules, user: dict[str, Any] = Depends(require_staff), gerance_id: Optional[str] = None
):
    target = _scoped_gerance(user, gerance_id)
    await db.finance_rules.update_one(
        {"gerance_id": target}, {"$set": {**payload.model_dump(), "updated_at": now_utc()}}, upsert=True
    )
    await audit(user, "finance_rules_updated", "settings", target, target, payload.model_dump())
    return payload


class MethodInput(BaseModel):
    name: str = Field(min_length=2)
    code: str = Field(min_length=2)
    number: str = ""
    holder: str = ""
    icon: str = "💳"
    active: bool = True
    instructions: str = ""
    sort_order: int = 0


class MethodOut(MethodInput):
    id: str
    gerance_id: str


@router.get("/payment-methods/manage", response_model=list[MethodOut])
async def list_methods(user: dict[str, Any] = Depends(require_staff), gerance_id: Optional[str] = None):
    target = _scoped_gerance(user, gerance_id)
    rows = await db.payment_methods.find({"gerance_id": target}, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return [MethodOut(**r) for r in rows]


@router.post("/payment-methods/manage", response_model=MethodOut)
async def create_method(payload: MethodInput, user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "edit_tontine")
    target = _scoped_gerance(user, None)
    if await db.payment_methods.find_one({"gerance_id": target, "code": payload.code.lower()}):
        raise HTTPException(status_code=409, detail="Ce moyen de paiement existe déjà dans votre gérance")
    doc = {"id": new_id(), "gerance_id": target, **payload.model_dump(), "created_at": now_utc()}
    doc["code"] = payload.code.lower()
    await db.payment_methods.insert_one(doc)
    await audit(user, "payment_method_created", "payment_method", doc["id"], target, {"name": payload.name})
    doc.pop("_id", None)
    doc.pop("created_at", None)
    return MethodOut(**doc)


@router.patch("/payment-methods/manage/{method_id}", response_model=MethodOut)
async def update_method(method_id: str, body: dict[str, Any], user: dict[str, Any] = Depends(require_staff)):
    ensure_permission(user, "edit_tontine")
    method = await db.payment_methods.find_one({"id": method_id}, {"_id": 0})
    if not method:
        raise HTTPException(status_code=404, detail="Moyen de paiement introuvable")
    assert_gerance_access(user, method["gerance_id"])
    allowed = {"name", "number", "holder", "icon", "active", "instructions", "sort_order"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=422, detail="Rien à mettre à jour")
    await db.payment_methods.update_one({"id": method_id}, {"$set": updates})
    await audit(user, "payment_method_updated", "payment_method", method_id, method["gerance_id"], updates)
    fresh = await db.payment_methods.find_one({"id": method_id}, {"_id": 0})
    assert fresh is not None
    fresh.pop("created_at", None)
    return MethodOut(**fresh)


@router.delete("/payment-methods/manage/{method_id}")
async def delete_method(method_id: str, user: dict[str, Any] = Depends(require_staff)):
    """Deleting a method never touches past transactions: they keep their own method label."""
    ensure_permission(user, "edit_tontine")
    method = await db.payment_methods.find_one({"id": method_id}, {"_id": 0})
    if not method:
        raise HTTPException(status_code=404, detail="Moyen de paiement introuvable")
    assert_gerance_access(user, method["gerance_id"])
    await db.payment_methods.delete_one({"id": method_id})
    await db.tontines.update_many(
        {"gerance_id": method["gerance_id"]}, {"$pull": {"payment_method_ids": method_id}}
    )
    await audit(user, "payment_method_deleted", "payment_method", method_id, method["gerance_id"],
                {"name": method["name"]})
    return {"ok": True}


class TontineMethodsInput(BaseModel):
    payment_method_ids: list[str]


@router.put("/tontines/{tontine_id}/payment-methods", response_model=list[str])
async def set_tontine_methods(
    tontine_id: str, payload: TontineMethodsInput, user: dict[str, Any] = Depends(require_staff)
):
    ensure_permission(user, "edit_tontine")
    tontine = await get_tontine(tontine_id)
    assert_gerance_access(user, tontine["gerance_id"])
    owned = await db.payment_methods.find(
        {"gerance_id": tontine["gerance_id"], "id": {"$in": payload.payment_method_ids}}, {"_id": 0, "id": 1}
    ).to_list(100)
    if len(owned) != len(set(payload.payment_method_ids)):
        raise HTTPException(status_code=422, detail="Un moyen de paiement n'appartient pas à cette gérance")
    ids = [o["id"] for o in owned]
    await db.tontines.update_one({"id": tontine_id}, {"$set": {"payment_method_ids": ids}})
    await audit(user, "tontine_methods_updated", "tontine", tontine_id, tontine["gerance_id"], {"ids": ids})
    return ids


class MemberMethod(BaseModel):
    id: str
    name: str
    code: str
    number: str
    holder: str
    icon: str
    instructions: str


@router.get("/tontines/{tontine_id}/payment-options", response_model=list[MemberMethod])
async def tontine_payment_options(tontine_id: str, _: Optional[dict[str, Any]] = Depends(optional_user)):
    """What a member may actually use: active methods of the gérance, restricted to the tontine."""
    tontine = await get_tontine(tontine_id)
    query: dict[str, Any] = {"gerance_id": tontine["gerance_id"], "active": True}
    selected = tontine.get("payment_method_ids")
    if selected:
        query["id"] = {"$in": selected}
    rows = await db.payment_methods.find(query, {"_id": 0}).sort("sort_order", 1).to_list(100)
    return [MemberMethod(**r) for r in rows]
