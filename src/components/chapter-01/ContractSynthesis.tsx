import React from 'react';
import { motion } from 'framer-motion';
import { Figure } from '@/components/scene';

const cards = [
  { letter: 'A', word: 'Atomicity',   failure: 'partial writes', color: 'var(--color-fig-orange)' },
  { letter: 'C', word: 'Consistency', failure: 'broken invariants', color: 'var(--color-fig-green)' },
  { letter: 'I', word: 'Isolation',   failure: 'lost updates', color: 'var(--color-fig-blue)' },
  { letter: 'D', word: 'Durability',  failure: 'silent data loss', color: 'var(--color-fig-red)' },
];

export function ContractSynthesis() {
  return (
    <Figure
      number="1.5"
      caption="Each letter of ACID is the name of a failure we just watched. A database is the machine that prevents each of them."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <motion.div
            key={c.letter}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.15, duration: 0.5 }}
            className="fig-card p-5 text-center"
          >
            <div className="text-5xl font-serif" style={{ color: c.color }}>{c.letter}</div>
            <div className="font-sans text-sm mt-1 font-semibold">{c.word}</div>
            <div className="font-sans text-[11px] mt-2 text-[color:var(--color-fig-muted)]">
              prevents <em className="not-italic" style={{ color: c.color }}>{c.failure}</em>
            </div>
          </motion.div>
        ))}
      </div>
    </Figure>
  );
}
