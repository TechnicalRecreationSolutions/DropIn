"use client";

import { Plus } from "lucide-react";
import {
  TRIAL_PERIOD_DAYS,
  EXTRA_FACILITY_MONTHLY,
  dollars,
} from "@/lib/stripe/plans";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const faqs = [
  {
    q: "Do the people using our schedule need an account?",
    a: "No. Anyone viewing your published schedule or the embedded widget sees it as a normal web page — no login, no app. Accounts are only for your staff.",
  },
  {
    q: "Can it match our website's look?",
    a: "The embeddable widget picks up your brand colour and fits the width of the page it's dropped into, so it reads as part of your site rather than a bolted-on redirect.",
  },
  {
    q: "We run more than one facility — does that work?",
    a: "Yes. One organization can hold several facilities, each with its own departments, spaces and schedule, and staff accounts scoped to the ones they manage.",
  },
  {
    q: "What exactly are we charged for?",
    a: `Facilities — the buildings you publish a schedule for. Each plan includes a number of them, and extra facilities are $${dollars(EXTRA_FACILITY_MONTHLY)} a month each. Nothing else is counted: departments, schedules, spaces, sessions, staff accounts, embeds and visitor traffic are all unlimited on every plan.`,
  },
  {
    q: "Do we pay more for splitting our schedule up?",
    a: "No, and that's deliberate. Breaking Aquatics into Lane Swim, Aqua Fit and Lessons is what lets visitors filter to the one they care about — charging for it would penalise the thing that makes the schedule useful. Departments and schedules are unlimited.",
  },
  {
    q: "How many staff accounts do we get?",
    a: "As many as you need, on every plan. The aquatics coordinator, the arena staff and whoever updates the website should all be editing their own part of the schedule — a seat limit would just mean a shared password.",
  },
  {
    q: "Is there a contract, or can we cancel?",
    a: `Month to month, no contract, and a ${TRIAL_PERIOD_DAYS}-day free trial to start. Cancel any time from your billing settings and you won't be charged again. Paying yearly gets you two months free; Enterprise can be invoiced annually against a purchase order.`,
  },
  {
    q: "Do we have to replace our registration system?",
    a: "No. Dropin publishes your drop-in schedule — the sessions anyone can show up to. Registered programs, memberships and payments stay wherever you run them today, which is why it slots in beside your existing system rather than replacing it.",
  },
];

export default function FaqSection() {
  return (
    <div className="mx-auto max-w-2xl divide-y divide-border">
      {faqs.map((item) => (
        <Collapsible key={item.q} className="py-4">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 text-left">
            <span className="font-medium text-foreground">{item.q}</span>
            <Plus className="w-4 h-4 text-muted-foreground/70 shrink-0 transition-transform group-data-[state=open]:rotate-45" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-sm text-muted-foreground leading-relaxed">
            {item.a}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
