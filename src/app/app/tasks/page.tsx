import { requirePageContext } from '@/lib/tenant';
import TaskList from '@/components/TaskList';

export default async function Tasks({ searchParams }: { searchParams: { done?: string } }) {
  const { tdb } = await requirePageContext();
  const showDone = searchParams.done === '1';
  const rows = await tdb.task.findMany({ where: showDone ? {} : { done: false }, orderBy: [{ done: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: 500,
    include: { employee: { select: { candidate: { select: { name: true } } } }, comments: { orderBy: { createdAt: 'desc' }, take: 1, select: { byEmployee: true, createdAt: true } } } });
  const tasks = rows.map((t) => ({
    id: t.id, title: t.title, dueAt: t.dueAt?.toISOString().slice(0, 10) ?? null, priority: t.priority, related: t.related, done: t.done,
    employee: t.employee?.candidate.name ?? null,
    // The latest word is the employee's (in the last two weeks): someone should read it.
    employeeUpdate: !!t.comments[0]?.byEmployee && t.comments[0].createdAt.getTime() > Date.now() - 14 * 864e5,
  }));
  return (
    <>
      <h1>Tasks</h1>
      <p className="lede">Follow-ups, reference checks, paperwork — everything with a date on it.</p>
      <TaskList tasks={tasks} showDone={showDone} />
    </>
  );
}
