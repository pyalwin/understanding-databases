import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '@/components/scene/Toggle';

test('reflects the value and calls onChange', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Toggle label="fsync" value={false} onChange={onChange} />);
  await user.click(screen.getByRole('switch'));
  expect(onChange).toHaveBeenCalledWith(true);
});

test('aria-checked tracks value', () => {
  render(<Toggle label="fsync" value={true} onChange={() => {}} />);
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
