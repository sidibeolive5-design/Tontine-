"""Printable PDF receipts (paiements validés et prises confirmées)."""

import base64
import io
from datetime import datetime
from typing import Any, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BRAND = colors.HexColor("#B4315C")
INK = colors.HexColor("#1F1A1D")
MUTED = colors.HexColor("#6B6169")

_styles = getSampleStyleSheet()
_title = ParagraphStyle("anvTitle", parent=_styles["Title"], fontSize=17, textColor=BRAND, spaceAfter=2)
_sub = ParagraphStyle("anvSub", parent=_styles["Normal"], fontSize=9, textColor=MUTED, alignment=TA_CENTER)
_h = ParagraphStyle("anvH", parent=_styles["Heading2"], fontSize=12, textColor=INK, spaceBefore=10, spaceAfter=4)
_p = ParagraphStyle("anvP", parent=_styles["Normal"], fontSize=9.5, textColor=INK, leading=13)
_small = ParagraphStyle("anvSmall", parent=_styles["Normal"], fontSize=8, textColor=MUTED, leading=11)


def fcfa(value: Any) -> str:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return "—"
    return f"{n:,}".replace(",", " ") + " FCFA"


def _fr_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y à %H:%M")
    return str(value or "—")


def _logo(platform: dict[str, Any]) -> Optional[Image]:
    raw = platform.get("logo_base64") or platform.get("logo") or ""
    if not isinstance(raw, str) or "base64," not in raw and not raw.startswith("iVBOR"):
        return None
    try:
        data = raw.split("base64,", 1)[-1]
        img = Image(io.BytesIO(base64.b64decode(data)))
        ratio = img.imageHeight / max(img.imageWidth, 1)
        img.drawWidth = 26 * mm
        img.drawHeight = 26 * mm * ratio
        return img
    except Exception:  # a broken logo must never break a receipt
        return None


def _rows_table(rows: list[tuple[str, str]]) -> Table:
    data = [[Paragraph(f"<b>{k}</b>", _p), Paragraph(v, _p)] for k, v in rows]
    t = Table(data, colWidths=[58 * mm, 105 * mm])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#E7DEE3")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#FAF5F7")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return t


def build_receipt(
    *,
    platform: dict[str, Any],
    kind: str,  # "payment" | "payout"
    receipt_number: str,
    rows: list[tuple[str, str]],
    total_label: str,
    total_value: str,
    footer_note: str,
    watermark: Optional[str] = None,
) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Reçu {receipt_number}",
        author=platform.get("name") or "AIDONS-NOUS VIVANTS",
    )
    name = platform.get("name") or "AIDONS-NOUS VIVANTS"
    tagline = platform.get("tagline") or ""
    contact = " · ".join(
        [str(v) for v in (platform.get("phone"), platform.get("whatsapp"), platform.get("email")) if v]
    )

    story: list[Any] = []
    logo = _logo(platform)
    header_cells: list[Any] = []
    if logo:
        header_cells.append(logo)
    header_cells.append(
        [
            Paragraph(name.upper(), _title),
            Paragraph(tagline, _small),
            Paragraph(contact, _small),
        ]
    )
    head = Table([header_cells], colWidths=[30 * mm, 133 * mm] if logo else [163 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(head)
    story.append(Spacer(1, 6 * mm))

    heading = "REÇU DE COTISATION" if kind == "payment" else "REÇU DE PRISE"
    banner = Table(
        [[Paragraph(f"<b>{heading}</b>", ParagraphStyle("bn", parent=_p, textColor=colors.white, fontSize=12)),
          Paragraph(f"<b>N° {receipt_number}</b>",
                    ParagraphStyle("bn2", parent=_p, textColor=colors.white, fontSize=11, alignment=2))]],
        colWidths=[100 * mm, 63 * mm],
    )
    banner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BRAND),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story.append(banner)
    story.append(Spacer(1, 5 * mm))
    story.append(_rows_table(rows))
    story.append(Spacer(1, 5 * mm))

    total = Table(
        [[Paragraph(f"<b>{total_label}</b>", ParagraphStyle("tl", parent=_p, fontSize=11)),
          Paragraph(f"<b>{total_value}</b>", ParagraphStyle("tv", parent=_p, fontSize=13, alignment=2,
                                                            textColor=BRAND))]],
        colWidths=[100 * mm, 63 * mm],
    )
    total.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FAF5F7")),
                ("BOX", (0, 0), (-1, -1), 0.6, BRAND),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story.append(total)

    if watermark:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph(f"<b>{watermark}</b>", ParagraphStyle("wm", parent=_small, textColor=BRAND)))

    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph(footer_note, _small))
    story.append(Spacer(1, 6 * mm))
    sign = Table(
        [[Paragraph("Signature du responsable", _small), Paragraph("Signature du membre", _small)]],
        colWidths=[81 * mm, 82 * mm],
    )
    sign.setStyle(
        TableStyle(
            [
                ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#C9BDC3")),
                ("TOPPADDING", (0, 0), (-1, -1), 16),
            ]
        )
    )
    story.append(sign)
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            f"Document généré automatiquement par {name} le {datetime.now().strftime('%d/%m/%Y à %H:%M')}.",
            _small,
        )
    )

    doc.build(story)
    return buffer.getvalue()


def receipt_datetime(value: Any) -> str:
    return _fr_datetime(value)
