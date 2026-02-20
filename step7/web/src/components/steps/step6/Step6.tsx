import { Step6Advisory } from './Step6Advisory';
import { useAdvisoryStore } from '@/stores/advisoryStore';

export function Step6() {
  const { showAdvisory } = useAdvisoryStore();

  const handleReviewSuccess = () => {
    showAdvisory('Review approved successfully! You can now proceed to the next step.');
  };

  return (
    <div>
      <Step6Advisory />
      <h2>Step 6: Review</h2>
      <button
        onClick={handleReviewSuccess}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Approve
      </button>
    </div>
  );
}
