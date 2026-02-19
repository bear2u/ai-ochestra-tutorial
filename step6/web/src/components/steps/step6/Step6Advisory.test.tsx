import { render, screen, fireEvent } from '@testing-library/react';
import { Step6Advisory } from './Step6Advisory';
import { useAdvisoryStore } from '@/stores/advisoryStore';

describe('Step6Advisory', () => {
  beforeEach(() => {
    localStorage.clear();
    useAdvisoryStore.getState().reset();
  });

  it('should not render when advisory is not visible', () => {
    render(<Step6Advisory />);
    expect(screen.queryByTestId('advisory')).not.toBeInTheDocument();
  });

  it('should render advisory message when visible', () => {
    useAdvisoryStore.getState().showAdvisory('Test advisory message');
    render(<Step6Advisory />);
    
    expect(screen.getByTestId('advisory')).toBeInTheDocument();
    expect(screen.getByText('Test advisory message')).toBeInTheDocument();
  });

  it('should dismiss advisory when close button is clicked', () => {
    useAdvisoryStore.getState().showAdvisory('Test message');
    render(<Step6Advisory />);
    
    const closeButton = screen.getByTestId('advisory-close');
    fireEvent.click(closeButton);
    
    expect(screen.queryByTestId('advisory')).not.toBeInTheDocument();
  });
});
