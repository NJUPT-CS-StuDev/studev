// For development only, when STUDEV_SNAPSHOTS is set: a file `snap.request` in the data folder, holding a path, makes
// the window render itself to that PNG at a set size, so its look can be checked when no screen shows it.
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Graphics.Imaging;

namespace StuDev;

internal static class Snapshot
{
    public static void Watch(FrameworkElement root)
    {
        if (Environment.GetEnvironmentVariable("STUDEV_SNAPSHOTS") is null) return;
        var request = Data.Storage.PathFor("snap.request");
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        timer.Tick += async (_, _) =>
        {
            if (!File.Exists(request)) return;
            var lines = File.ReadAllLines(request); File.Delete(request);
            var target = lines[0];
            if (lines.Length > 1 && lines[1].Split('x') is [var w, var h]) { root.Width = double.Parse(w); root.Height = double.Parse(h); root.UpdateLayout(); }
            var bitmap = new RenderTargetBitmap();
            await bitmap.RenderAsync(root);
            var pixels = await bitmap.GetPixelsAsync();
            using var stream = new Windows.Storage.Streams.InMemoryRandomAccessStream();
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(pixels));
            await encoder.FlushAsync();
            var bytes = new byte[stream.Size]; stream.Seek(0);
            await stream.AsStreamForRead().ReadExactlyAsync(bytes);
            File.WriteAllBytes(target, bytes);
        };
        timer.Start();
    }
}
