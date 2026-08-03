import Link from 'next/link';
import { Bot, Brain, MessageSquare, Mic, Plug, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const features = [
  {
    icon: MessageSquare,
    title: 'Conversational AI',
    description: 'Streaming, markdown-rendered chat with full conversation history.',
  },
  {
    icon: Brain,
    title: 'Long-term memory',
    description: 'The assistant remembers preferences and past conversations over time.',
  },
  {
    icon: Mic,
    title: 'Voice interface',
    description: 'Speak naturally with speech-to-text and instant spoken replies.',
  },
  {
    icon: Plug,
    title: 'Modular tools',
    description: 'Calculator, web search, file access and more — installable plugins.',
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

export default function LandingPage(): React.JSX.Element {
  return (
    <div className="container mx-auto max-w-6xl px-4">
      <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
        <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          Your personal AI assistant
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Meet BRO, the assistant that remembers, listens, and acts
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          A production-grade, self-hosted AI assistant with chat, long-term memory, voice, tools,
          and workflow automation — built with TypeScript, Fastify, Next.js, and LangGraph.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/register">
            <Button size="lg">Get started free</Button>
          </Link>
          <Link href="/login">
            <Button variant="outline" size="lg">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-6 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <Card key={feature.title} className="transition-colors hover:border-ring/50">
            <CardContent className="flex flex-col gap-3 p-6">
              <feature.icon className="h-6 w-6 text-primary" />
              <h3 className="text-base font-semibold">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
