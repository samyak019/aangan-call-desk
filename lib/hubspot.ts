// HubSpot free CRM — every qualified call becomes a contact + deal, so the designers'
// pipeline lives in the CRM, not in Telegram scrollback. Needs a private-app token
// with crm.objects.contacts.write + crm.objects.deals.write scopes.

import type { Classification } from "./types";

const BASE = "https://api.hubapi.com/crm/v3/objects";
const DEAL_TO_CONTACT = 3; // HUBSPOT_DEFINED association type id

export const hubspotConfigured = () => Boolean(process.env.HUBSPOT_TOKEN);

async function hs(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function upsertContact(name: string | null, phone: string | null): Promise<string> {
  if (phone) {
    const found = await hs("/contacts/search", {
      filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }],
      limit: 1,
    });
    if (found.results?.[0]?.id) return found.results[0].id;
  }
  const [first, ...rest] = (name ?? "Phone caller").split(" ");
  const c = await hs("/contacts", {
    properties: { firstname: first, lastname: rest.join(" "), phone: phone ?? "", hs_lead_status: "NEW" },
  });
  return c.id;
}

export async function createDeal(c: Classification, ctx: { callerPhone: string | null; bookedSlot: string | null; handoffText: string | null }) {
  const f = c.facts;
  const contactId = await upsertContact(f.caller_name, ctx.callerPhone);
  const label = [f.property_type, f.locality].filter(Boolean).join(", ") || "New project";
  const deal = await hs("/deals", {
    properties: {
      dealname: `${f.caller_name ?? "Caller"} — ${label}`,
      pipeline: process.env.HUBSPOT_PIPELINE || "default",
      dealstage: ctx.bookedSlot
        ? process.env.HUBSPOT_STAGE_BOOKED || "appointmentscheduled"
        : process.env.HUBSPOT_STAGE_NEW || "qualifiedtobuy",
      description: (ctx.handoffText ?? f.summary).slice(0, 4000),
    },
    associations: [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: DEAL_TO_CONTACT }] }],
  });
  return { contactId, dealId: deal.id as string };
}
