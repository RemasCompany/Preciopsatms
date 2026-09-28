import { requirePageContext } from '@/lib/tenant';
import TaskList from '@/components/TaskList';

export default async function Tasks({ searchParams }: { searchParams: { done?: string } }) {
  const { tdb } = await requirePageContext();
  const showDone = searchParams.done === '1';
  const rows = await tdb.task.findMany({ where: showDone ? {} : { done: false }, orderBy: [{ done: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 500 });
  const tasks = rows.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt?.toISOString().slice(0, 10) ?? null, priority: t.priority, related: t.related, done: t.done }));
  return (
    <>
      <h1>Tasks</h1>
      <p className="lede">Follow-ups, reference checks, paperwork — everything with a date on it.</p>
      <TaskList tasks={tasks} showDone={showDone} />
    </>
  );
}
