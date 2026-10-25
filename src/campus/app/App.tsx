import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppRouter } from '@/app/routing/useAppRouter';
import { HomePage } from '@/home/HomePage';
import { useSiteHeaderSearch } from '@/app/shell/useSiteHeaderSearch';
import { ModuleNav } from '@/app/shell/ModuleNav';
import type { AppRoute } from '@/app/routing/useUrlState';
import { SearchClient } from 'wasm-search';
import { APP_CONFIG } from '@/app/config/constants';
import { ExamSnapshotClient } from '@/exams/model/ExamSnapshotClient';
import type { ExamHistoryClient } from '@/exams/model/ExamHistoryClient';
import type { ProductIntent } from '@/app/routing/intents';
import { ExamLanding } from '@/exams/ExamLanding';
import { PAGE_IDENTITIES } from '@/app/seo/pageSeo';
import { TeachingScheduleClient } from '@/timetable/model/TeachingScheduleClient';
import { ClassroomAvailabilityClient } from '@/classrooms/model/ClassroomAvailabilityClient';
import { TimetableLanding } from '@/timetable/TimetableLanding';
import { searchScopeForRoute } from '@/search/searchScopes';
import { usePreferences } from '@/shared/lib/usePreferences';

const loadSearchPage = () => import('@/search/SearchPage').then(module => ({ default: module.SearchPage }));
const loadExamPage = () => import('@/exams/ExamPage').then(module => ({ default: module.ExamPage }));
const loadTimetablePage = () => import('@/timetable/TimetablePage').then(module => ({ default: module.TimetablePage }));
const loadClassroomsPage = () => import('@/classrooms/ClassroomsView').then(module => ({ default: module.ClassroomsView }));
const SearchPage = lazy(loadSearchPage);
const ExamPage = lazy(loadExamPage);
const TimetablePage = lazy(loadTimetablePage);
const ClassroomsView = lazy(loadClassroomsPage);

function RouteLoading() {
    return (
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 pt-6 pb-8">
            <div className="h-24 animate-pulse rounded-2xl bg-[#f1f3f4] dark:bg-[#1c232b]" aria-busy="true" aria-label="正在打开页面" />
            <div className="mt-4 h-[420px] animate-pulse rounded-2xl bg-[#f8f9fa] dark:bg-[#1c232b]" />
        </main>
    );
}

function App({ initialRoute }: { initialRoute: AppRoute }) {
    const router = useAppRouter(initialRoute);
    const { prefs, ready } = usePreferences();
    const myClass = prefs.class ?? null;
    // The address and saved settings are applied now; show the page.
    useEffect(() => {
        if (ready) delete document.documentElement.dataset.campusPending;
    }, [ready]);
    useSiteHeaderSearch(router.route, router.inputValue, router.onInputChange, router.onSubmit);
    // A search typed into the site header on any other page arrives as /search/?q=…
    useEffect(() => {
        if (router.route !== 'home') return;
        const homeQuery = new URLSearchParams(window.location.search).get('q');
        if (homeQuery?.trim()) router.onSubmit(homeQuery, true);
    }, [router.route, router.onSubmit]);
    useEffect(() => {
        const page = PAGE_IDENTITIES[router.route];
        document.title = `${page.title} — StuDev`;
    }, [router.route]);
    const searchClient = useMemo(() => new SearchClient({
        baseUrl: APP_CONFIG.DATA_URLS.SEARCH,
    }), []);
    const examClient = useMemo(() => new ExamSnapshotClient(APP_CONFIG.DATA_URLS.EXAMS), []);
    const historyClientRef = useRef<ExamHistoryClient | null>(null);
    const historyClientPromiseRef = useRef<Promise<ExamHistoryClient> | null>(null);
    const [examHistoryClient, setExamHistoryClient] = useState<ExamHistoryClient | null>(null);
    const loadExamHistoryClient = useCallback((): Promise<ExamHistoryClient> => {
        if (historyClientRef.current) return Promise.resolve(historyClientRef.current);
        if (!historyClientPromiseRef.current) {
            historyClientPromiseRef.current = import('@/exams/model/ExamHistoryClient').then(module => {
                const client = new module.ExamHistoryClient(examClient);
                historyClientRef.current = client;
                setExamHistoryClient(client);
                return client;
            });
        }
        return historyClientPromiseRef.current;
    }, [examClient]);
    const teachingClient = useMemo(() => new TeachingScheduleClient(APP_CONFIG.DATA_URLS.TIMETABLE), []);
    const classroomClient = useMemo(() => new ClassroomAvailabilityClient(APP_CONFIG.DATA_URLS.CLASSROOMS), []);
    const disposeTimerRef = useRef<number | null>(null);
    useEffect(() => {
        if (disposeTimerRef.current !== null) window.clearTimeout(disposeTimerRef.current);
        return () => {
            disposeTimerRef.current = window.setTimeout(() => {
                searchClient.dispose();
                examClient.dispose();
                historyClientRef.current?.dispose();
                teachingClient.dispose();
                classroomClient.dispose();
            }, 0);
        };
    }, [classroomClient, examClient, searchClient, teachingClient]);
    useEffect(() => {
        if (router.route !== 'exam') return;
        void loadExamHistoryClient()
            .then(client => client.initialize())
            .catch(() => {
                // Exam history is supplementary and reports its own failure state.
            });
    }, [loadExamHistoryClient, router.route]);
    const warmSearch = () => {
        void loadSearchPage();
        void searchClient.initialize().catch(() => {
            // SearchPage presents initialization errors and can retry this client.
        });
    };
    const warmIntent = (intent: ProductIntent) => {
        if (intent.kind === 'search' || intent.kind === 'community' || intent.kind === 'materials') {
            warmSearch();
            return;
        }
        if (intent.kind === 'exam') {
            void loadExamPage();
            void examClient.initialize().catch(() => {
                // ExamPage presents artifact errors and can retry through navigation.
            });
            void loadExamHistoryClient()
                .then(client => client.initialize())
                .catch(() => {
                    // Exam history is supplementary and reports its own failure state.
                });
            return;
        }
        if (intent.kind === 'timetable') {
            void loadTimetablePage();
            void teachingClient.initialize().catch(() => undefined);
            return;
        }
        if (intent.kind === 'classrooms') {
            void loadClassroomsPage();
            void classroomClient.initialize().catch(() => undefined);
            return;
        }
    };

    return (
        <div className="campus-app min-h-[calc(100vh-145px)] flex flex-col bg-white dark:bg-[#14181d] text-[#202124] dark:text-[#e8edf3] font-sans">
            {router.route !== 'home' ? <ModuleNav route={router.route} onNavigate={router.onNavigateRoute} /> : null}

            {router.route === 'home' ? (
                <HomePage
                    inputValue={router.inputValue}
                    onQuickSearch={(intent) => {
                        warmIntent(intent);
                        router.onQuickSearch(intent);
                    }}
                    onInputChange={router.onInputChange}
                    onSubmit={router.onSubmit}
                    onSearchWarm={warmSearch}
                    onIntentWarm={warmIntent}
                />
            ) : null}

            <Suspense fallback={<RouteLoading />}>
                {router.route === 'search' || router.route === 'community' || router.route === 'materials' ? (
                    <SearchPage
                        key={router.route}
                        query={router.search.query}
                        client={searchClient}
                        scope={searchScopeForRoute(router.route)}
                        onScopeChange={router.navigateSearchScope}
                        onSearch={router.onSubmit}
                    />
                ) : null}

                {router.route === 'exam' ? (
                    !router.exam.query && !router.exam.className && !myClass ? (
                        <ExamLanding
                            savedClass={myClass}
                            onSubmit={router.onSubmit}
                            onOpenClass={(className) => router.onSubmit(className)}
                            client={examClient}
                            historyClient={examHistoryClient}
                        />
                    ) : (
                        <ExamPage
                            query={router.exam.query}
                            className={router.exam.className ?? (router.exam.query ? null : myClass)}
                            onOpenClass={(className) => router.onSubmit(className)}
                            client={examClient}
                            historyClient={examHistoryClient}
                            teachingClient={teachingClient}
                        />
                    )
                ) : null}

                {router.route === 'timetable' ? (
                    !router.timetable.className && !myClass ? (
                        <TimetableLanding
                            client={teachingClient}
                            savedClass={myClass}
                            initialQuery={router.timetable.query}
                            onOpenClass={(className) => router.navigateTimetable({ class: className, week: null })}
                        />
                    ) : (
                        <TimetablePage
                            className={router.timetable.className ?? myClass ?? ''}
                            week={router.timetable.week}
                            courseQuery={router.timetable.query}
                            client={teachingClient}
                            onChange={router.navigateTimetable}
                        />
                    )
                ) : null}

                {router.route === 'classrooms' ? (
                    <ClassroomsView
                        {...router.classrooms}
                        filter={router.inputValue}
                        client={classroomClient}
                        onChange={router.navigateClassrooms}
                    />
                ) : null}
            </Suspense>

        </div>
    );
}

export default App;
