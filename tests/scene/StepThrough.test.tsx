import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepThrough } from '@/components/scene/StepThrough';

const steps = [
  { label: 'one',   content: <p>step one</p> },
  { label: 'two',   content: <p>step two</p> },
  { label: 'three', content: <p>step three</p> },
];

test('renders the first step by default', () => {
  render(<StepThrough steps={steps} />);
  expect(screen.getByText('step one')).toBeInTheDocument();
});

test('next button advances and prev button rewinds', async () => {
  const user = userEvent.setup();
  render(<StepThrough steps={steps} />);
  await user.click(screen.getByRole('button', { name: /next/i }));
  expect(screen.getByText('step two')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /prev/i }));
  expect(screen.getByText('step one')).toBeInTheDocument();
});

test('next at the last step is a no-op', async () => {
  const user = userEvent.setup();
  render(<StepThrough steps={steps} initial={2} />);
  await user.click(screen.getByRole('button', { name: /next/i }));
  expect(screen.getByText('step three')).toBeInTheDocument();
});

test('prev at the first step is a no-op', async () => {
  const user = userEvent.setup();
  render(<StepThrough steps={steps} />);
  await user.click(screen.getByRole('button', { name: /prev/i }));
  expect(screen.getByText('step one')).toBeInTheDocument();
});

test('scrubber input jumps to a step by index', () => {
  render(<StepThrough steps={steps} />);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '2' } });
  expect(screen.getByText('step three')).toBeInTheDocument();
});
