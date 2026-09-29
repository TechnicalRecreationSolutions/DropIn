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
    q: "Do we have to replace our registration system?",
    a: "No. Keep ActiveNet or Xplor for registration, memberships and payments. Dropin shows the schedule, and links to your registration page where a session needs it.",
  },
  {
    q: "Does it pull our schedule from ActiveNet or Xplor?",
    a: "No. Staff enter the schedule in Dropin. To get started you can import a CSV file, then assign lanes by hand before sessions show in the lane views.",
  },
  {
    q: "Will the public see who rented the pool?",
    a: "No. Rentals and clubs show as “Reserved”, with the time and the lanes. Only your staff see the name and the set-up notes.",
  },
  {
    q: "Can patrons print it?",
    a: "Yes. Turn on the print button and they print the week they are looking at, with the date it was printed and a note that times can change.",
  },
  {
    q: "Do patrons need an account?",
    a: "No. Anyone can view the schedule as a normal web page. No login, no app. Accounts are only for your staff.",
  },
  {
    q: "Can it match our website?",
    a: "Yes. You set your brand colour and add your logo, and the schedule fits the width of the page it sits in.",
  },
  {
    q: "We run more than one facility — does that work?",
    a: "Yes. One organization can hold several facilities, each with its own departments, spaces and schedule, and coordinators limited to their own department.",
  },
  {
    q: "What exactly are we charged for?",
    a: `Facilities — the buildings you publish a schedule for. Each plan includes a number of them, and extra facilities are $${dollars(EXTRA_FACILITY_MONTHLY)} a month each. Nothing else is counted: departments, schedules, spaces, sessions, staff accounts, embeds and visitor traffic are all unlimited on every plan.`,
  },
  {
    q: "Is there a contract, or can we cancel?",
    a: `Month to month, no contract, and a ${TRIAL_PERIOD_DAYS}-day free trial to start. Cancel any time from your billing settings and you won't be charged again. Paying yearly gets you two months free; Enterprise can be invoiced annually against a purchase order.`,
  },
];

export default function FaqSection() {
  return (
    <div className="flex-1 divide-y divide-[#e4e4e7] border-y border-[#e4e4e7]">
      {faqs.map((item, i) => (
        <Collapsible key={item.q} defaultOpen={i === 0}>
          <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between gap-6 py-[22px] text-left text-[17px] font-medium text-[#111113] focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066cc]">
            <span>{item.q}</span>
            <Plus className="h-5 w-5 shrink-0 text-[#111113] transition-transform group-data-[state=open]:rotate-45" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pr-0 pb-6 text-[15px] leading-[25px] text-[#5d5d63] sm:pr-12">
            {item.a}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
