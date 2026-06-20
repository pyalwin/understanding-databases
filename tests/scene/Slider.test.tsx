import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Slider } from '@/components/scene/Slider';

test('calls onChange with numeric value', () => {
  const onChange = vi.fn();
  render(<Slider label="bytes" min={0} max={100} step={1} value={10} onChange={onChange} />);
  const range = screen.getByRole('slider');
  fireEvent.change(range, { target: { value: '42' } });
  expect(onChange).toHaveBeenCalledWith(42);
});
