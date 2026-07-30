import FacilityForm from "@/components/facility/FacilityForm";

export const metadata = { title: "Add Facility" };

export default function NewFacilityPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Add a facility</h1>
        <p className="text-gray-500 mt-1">
          A facility is a physical location where your schedules take place.
        </p>
      </div>
      <FacilityForm />
    </div>
  );
}
