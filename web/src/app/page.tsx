'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { ArrowRight, Bot, Brain, MessageSquare, Mic, Plug, Sparkles, Workflow } from 'lucide-react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
};

const features = [
  {
    icon: MessageSquare,
    title: 'Conversational AI',
    description:
      'Streaming, markdown-rendered chat with full conversation history and inline tool calls.',
  },
  {
    icon: Brain,
    title: 'Long-term memory',
    description: 'The assistant remembers your preferences and past conversations over time.',
  },
  {
    icon: Mic,
    title: 'Voice interface',
    description: 'Speak naturally with speech-to-text and instant spoken replies.',
  },
  {
    icon: Plug,
    title: 'Modular tools',
    description: 'Calculator, web search, file access and more — installable plugins on demand.',
  },
  {
    icon: Workflow,
    title: 'Automation',
    description: 'Trigger and monitor n8n workflows directly from the chat.',
  },
  {
    icon: Bot,
    title: 'Personal assistant',
    description: 'A secure, self-hosted assistant that keeps your data under your control.',
  },
];

const chips = [
  'Streaming chat',
  'Long-term memory',
  'Voice replies',
  'Tools & plugins',
  'n8n automation',
  'Self-hosted',
];

function HeroBackdrop(): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="hud-grid absolute inset-0 animate-hud-pan" />
      <div className="absolute inset-x-0 top-0 flex justify-center">
        <div className="animate-drift -mt-24 h-[36rem] w-[36rem] rounded-full bg-neon-cyan/15 blur-3xl" />
      </div>
      <div
        className="animate-drift absolute left-[-10rem] top-1/3 h-80 w-80 rounded-full bg-neon-purple/15 blur-3xl"
        style={{ animationDelay: '-8s' }}
      />
      <div
        className="animate-drift absolute bottom-[-6rem] right-[-8rem] h-96 w-96 rounded-full bg-neon-blue/15 blur-3xl"
        style={{ animationDelay: '-16s' }}
      />
      <div className="animate-float absolute left-[12%] top-[24%] h-24 w-24 rounded-full bg-neon-pink/20 blur-2xl" />
      <div
        className="animate-float absolute right-[14%] top-[20%] h-16 w-16 rounded-full bg-neon-cyan/25 blur-xl"
        style={{ animationDelay: '-2.5s' }}
      />
      <div className="animate-scanline absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/40 to-transparent" />
    </div>
  );
}

export default function LandingPage(): React.JSX.Element {
  const prefersReducedMotion = useReducedMotion() ?? false;

  return (
    <div className="relative">
      {/* ---------- Hero ---------- */}
      <section className="relative flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-center overflow-hidden px-4 py-24 text-center">
        <HeroBackdrop />

        <motion.div
          variants={containerVariants}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate="show"
          className="relative flex flex-col items-center"
        >
          <motion.div variants={itemVariants} className="relative mb-10">
            <div className="animate-spin-slow absolute -inset-10 rounded-[2.75rem] bg-[conic-gradient(from_90deg,var(--neon-cyan),var(--neon-blue),var(--neon-purple),var(--neon-pink),var(--neon-cyan))] opacity-40 blur-2xl" />
            <div className="animate-pulse-ring absolute -inset-3 rounded-3xl border border-neon-cyan/50" />
            <div className="glass relative animate-float rounded-3xl p-2.5">
              <Logo priority className="h-28 w-auto rounded-2xl sm:h-36" />
            </div>
          </motion.div>

          <motion.div variants={itemVariants}>
            <span className="glass inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xs font-medium tracking-wide text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-cyan opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-neon-cyan" />
              </span>
              BRO — your personal AI assistant
            </span>
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="mt-7 max-w-4xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl"
          >
            Meet <span className="neon-text">BRO</span>, the assistant that{' '}
            <span className="animate-gradient-x bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink bg-clip-text text-transparent">
              remembers, listens &amp; acts
            </span>
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground"
          >
            A production-grade, self-hosted AI assistant with chat, long-term memory, voice, tools,
            and workflow automation — built with TypeScript, Fastify, Next.js, and LangGraph.
          </motion.p>

          <motion.div
            variants={itemVariants}
            className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
          >
            <Link href="/register">
              <Button size="lg" className="group gap-2">
                Get started free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg">
                Sign in
              </Button>
            </Link>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="mt-12 flex max-w-2xl flex-wrap items-center justify-center gap-2"
          >
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground"
              >
                {chip}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="relative mx-auto max-w-6xl px-4 pb-24">
        <motion.div
          variants={containerVariants}
          initial={prefersReducedMotion ? false : 'hidden'}
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.span
            variants={itemVariants}
            className="text-sm font-semibold uppercase tracking-[0.2em] text-neon-cyan"
          >
            Capabilities
          </motion.span>
          <motion.h2
            variants={itemVariants}
            className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Everything you expect from a real copilot
          </motion.h2>
          <motion.p variants={itemVariants} className="mt-4 text-muted-foreground">
            One assistant for your conversations, memory, voice, and automations — running entirely
            on your hardware.
          </motion.p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial={prefersReducedMotion ? false : 'hidden'}
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => (
            <motion.div key={feature.title} variants={itemVariants}>
              <div className="glass glass-hover group flex h-full flex-col gap-4 rounded-2xl p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan/20 via-neon-blue/20 to-neon-purple/20 text-neon-cyan transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ---------- CTA banner ---------- */}
      <section className="relative mx-auto max-w-6xl px-4 pb-28">
        <motion.div
          variants={containerVariants}
          initial={prefersReducedMotion ? false : 'hidden'}
          whileInView="show"
          viewport={{ once: true, margin: '-80px' }}
          className="glass-strong relative overflow-hidden rounded-3xl px-8 py-16 text-center sm:py-20"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/4 top-[-6rem] h-64 w-64 rounded-full bg-neon-cyan/20 blur-3xl" />
            <div className="absolute bottom-[-6rem] right-1/4 h-64 w-64 rounded-full bg-neon-purple/20 blur-3xl" />
          </div>

          <motion.h2
            variants={itemVariants}
            className="relative text-3xl font-bold tracking-tight sm:text-4xl"
          >
            Ready to meet <span className="neon-text">BRO</span>?
          </motion.h2>
          <motion.p
            variants={itemVariants}
            className="relative mx-auto mt-4 max-w-xl text-muted-foreground"
          >
            Set up your workspace in minutes and start a conversation that actually remembers you.
          </motion.p>
          <motion.div
            variants={itemVariants}
            className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link href="/register">
              <Button size="lg" className="group gap-2">
                <Sparkles className="h-4 w-4" />
                Create your assistant
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg">
                Sign in
              </Button>
            </Link>
          </motion.div>
        </motion.div>
      </section>
    </div>
  );
}
