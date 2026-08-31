"use client";

import { Plus } from "lucide-react";
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
    q: "Is there a contract, or can we cancel?",
    a: "Month to month, no contract. Cancel any time from your billing settings and you won't be charged again.",
  },
];

export default function FaqSection() {
  return (
    <div className="mx-auto max-w-2xl divide-y divide-gray-200">
      {faqs.map((item) => (
        <Collapsible key={item.q} className="py-4">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 text-left">
            <span className="font-medium text-gray-900">{item.q}</span>
            <Plus className="w-4 h-4 text-gray-400 shrink-0 transition-transform group-data-[state=open]:rotate-45" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 text-sm text-gray-600 leading-relaxed">
            {item.a}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
