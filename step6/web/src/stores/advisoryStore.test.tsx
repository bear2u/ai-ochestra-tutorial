import { renderHook, act } from '@testing-library/react';
import { useAdvisoryStore } from './advisoryStore';

describe('AdvisoryStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAdvisoryStore.getState().reset();
  });

  describe('showAdvisory', () => {
    it('should show advisory when called', () => {
      const { result } = renderHook(() => useAdvisoryStore());
      
      act(() => {
        result.current.showAdvisory('Test advisory message');
      });
      
      expect(result.current.isVisible).toBe(true);
      expect(result.current.message).toBe('Test advisory message');
    });
  });

  describe('dismissAdvisory', () => {
    it('should hide advisory when dismissed', () => {
      const { result } = renderHook(() => useAdvisoryStore());
      
      act(() => {
        result.current.showAdvisory('Test message');
      });
      
      act(() => {
        result.current.dismissAdvisory();
      });
      
      expect(result.current.isVisible).toBe(false);
    });
  });
});
