/**
 * student-example — React + Tailwind micro-app (example code; "student"/"course" are fixture vocabulary, not platform
 * concepts). Demonstrates: public page, HYBRID page whose capabilities grow after login, authenticated page,
 * permission-based actions (UI hints; the backend re-authorizes), dynamic backend routes and workspace events.
 */
import {useEffect, useState} from 'react';
import type {HiveMountContext} from '@hive-platform/contracts';
import {createHttpClient, HiveHttpError} from '@hive-platform/http-client';
import {createReactMicroApp} from '@hive-platform/react';
import css from '../dist/tailwind.css';

const http = createHttpClient();
const api = '/api/routes/students';

interface Course {id: string; title: string; summary: string; personalized?: boolean}
interface Student {id: string; name: string}

function useLoad<T>(path: string | null, signal: AbortSignal, deps: unknown[]): {data: T | null; error: string | null} {
  const [state, setState] = useState<{data: T | null; error: string | null}>({data: null, error: null});
  useEffect(() => {
    if (!path) return;
    let active = true;
    http.get<T>(path, {signal}).then(data => active && setState({data, error: null}))
      .catch(error => active && setState({data: null, error: error instanceof HiveHttpError ? error.code : 'NETWORK_FAILURE'}));
    return () => { active = false; };
  }, deps);
  return state;
}

function Shell({context, children}: {context: HiveMountContext; children: React.ReactNode}) {
  return (
    <div className="font-sans text-slate-800 antialiased" data-testid="student-example" data-instance={context.instanceId}>
      <style>{css}</style>
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50 p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-500">Campus · React + Tailwind</span>
          <span className="text-xs text-slate-500" data-testid="viewer">{context.context.authenticated ? context.context.identity.displayName : 'Visitor'}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Campus({context}: {context: HiveMountContext}) {
  return (
    <Shell context={context}>
      <h2 className="text-2xl font-bold text-indigo-900" data-testid="campus-title">Welcome to the campus</h2>
      <p className="mt-2 text-slate-600">Public page — no sign-in required.</p>
      <button className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700" data-testid="browse-courses" onClick={() => context.navigate('/courses')}>Browse courses</button>
    </Shell>
  );
}

function Courses({context}: {context: HiveMountContext}) {
  const {data, error} = useLoad<{courses: Course[]}>(`${api}/courses`, context.signal, []);
  return (
    <Shell context={context}>
      <h2 className="text-xl font-bold text-indigo-900">Courses</h2>
      {error && <p className="text-red-600" data-testid="error">{error}</p>}
      <ul className="mt-3 space-y-2">
        {data?.courses.map(course => (
          <li key={course.id}><button className="w-full rounded-lg bg-white px-3 py-2 text-left shadow-sm ring-1 ring-slate-200 hover:ring-indigo-300" data-course={course.id}
            onClick={() => context.navigate(`/courses/${course.id}`)}>{course.title}</button></li>
        ))}
      </ul>
    </Shell>
  );
}

/** HYBRID: anonymous visitors read the course; signed-in users may enroll when permitted. */
function CourseDetail({context}: {context: HiveMountContext}) {
  const id = context.params['courseId'] ?? '';
  const {data, error} = useLoad<Course>(`${api}/courses/${encodeURIComponent(id)}`, context.signal, [id, context.context.authenticated]);
  const [enrollment, setEnrollment] = useState<string | null>(null);
  const canEnroll = context.permissions.can('student-example.courses', 'enroll');
  const enroll = async () => {
    try {
      const result = await http.post<{enrolled: boolean}>(`${api}/courses/${encodeURIComponent(id)}/enrollments`, {});
      setEnrollment(result.enrolled ? 'ENROLLED' : 'NOT_ENROLLED');
    } catch (e) {
      setEnrollment(e instanceof HiveHttpError ? e.code : 'FAILED');
    }
  };
  return (
    <Shell context={context}>
      {error && <p className="text-red-600" data-testid="error">{error}</p>}
      {data && <>
        <h2 className="text-xl font-bold text-indigo-900" data-testid="course-title">{data.title}</h2>
        <p className="mt-1 text-slate-600">{data.summary}</p>
        {data.personalized && <p className="mt-1 text-sm text-emerald-700" data-testid="personalized">Personalized for you</p>}
      </>}
      <div className="mt-4" data-testid="course-actions">
        {!context.context.authenticated
          ? <a className="rounded-lg border border-indigo-600 px-4 py-2 text-indigo-700" data-testid="sign-in-to-enroll"
              href={`/auth/login?returnUrl=${encodeURIComponent(context.route)}`}>Sign in to enroll</a>
          : canEnroll
            ? <button className="rounded-lg bg-emerald-600 px-4 py-2 text-white" data-testid="enroll" onClick={() => void enroll()}>Enroll</button>
            : <span className="text-sm text-slate-500" data-testid="cannot-enroll">Enrollment is not available for your account.</span>}
        {enrollment && <p className="mt-2 text-sm" data-testid="enrollment-result">{enrollment}</p>}
      </div>
    </Shell>
  );
}

function Students({context}: {context: HiveMountContext}) {
  const {data, error} = useLoad<{students: Student[]}>(`${api}/students`, context.signal, []);
  const [selected, setSelected] = useState<string | null>(null);
  const canAnnotate = context.permissions.can('student-example.list', 'annotate');
  return (
    <Shell context={context}>
      <h2 className="text-xl font-bold text-indigo-900">Students</h2>
      {error && <p className="text-red-600" data-testid="error">{error}</p>}
      <ul className="mt-3 divide-y divide-slate-200 rounded-lg bg-white ring-1 ring-slate-200">
        {data?.students.map(student => (
          <li key={student.id} className="flex items-center justify-between px-3 py-2">
            <button className={student.id === selected ? 'font-semibold text-indigo-700' : ''} data-student={student.id}
              onClick={() => { setSelected(student.id); context.events.publish('campus:record-selected', {recordId: student.id}); }}>{student.name}</button>
            {canAnnotate && <button className="rounded bg-amber-100 px-2 text-xs text-amber-800" data-testid={`annotate-${student.id}`}>Annotate</button>}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function StudentApp({context}: {context: HiveMountContext}) {
  const key = context.route.startsWith('/courses/') ? 'course' : context.route.startsWith('/courses') ? 'courses' : context.route.startsWith('/students') ? 'students' : 'campus';
  return key === 'course' ? <CourseDetail context={context} /> : key === 'courses' ? <Courses context={context} /> : key === 'students' ? <Students context={context} /> : <Campus context={context} />;
}

export default createReactMicroApp(StudentApp);
