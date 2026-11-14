// Where StuDev starts: Velopack first (installing, updating and uninstalling run through here and end the process),
// then the WinUI application on its own thread.
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Velopack;

namespace StuDev;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().OnFirstRun(_ => Me.Updates.RetireTauri()).Run();
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(start =>
        {
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread()));
            _ = new App();
        });
    }
}
