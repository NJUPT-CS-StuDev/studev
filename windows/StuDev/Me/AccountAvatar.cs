using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using StuDev.Ui;
using Windows.Storage.Streams;

namespace StuDev.Me;

/** The same locally cached QQ picture in the account page and the window header. */
public sealed partial class AccountAvatar : Grid
{
    private readonly ContentControl fallback = new() { HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center };
    private readonly Ellipse picture = new() { Opacity = 0 };
    private string? identity;
    private DateTime retryAt;
    private int load;
    public string Status { get; private set; } = "未登录";
    public event Action? Changed;

    public AccountAvatar(double diameter = 32)
    {
        Width = Height = diameter;
        Children.Add(new Ellipse { Fill = Paint.Brush("surfaceSunken") });
        Children.Add(fallback);
        Children.Add(picture);
        AutomationProperties.SetName(this, "头像");
    }

    public void Show(AccountUser? user)
    {
        fallback.Content = user is null ? Kit.Icon(Icons.Person, Width * 18 / 32, "muted", 24, 1.8) : new TextBlock
        {
            Text = user.Letter, FontSize = Width * 12.5 / 32, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            Foreground = Paint.Brush("muted"), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
        };
        var address = user is null ? null : AvatarCache.Address(user);
        var file = address is null ? null : AvatarCache.FileFor(user!.Id, address);
        var next = file ?? user?.Id;
        if (identity == next && (address is null || DateTime.UtcNow < retryAt)) return;
        if (identity != next)
        {
            identity = next;
            picture.Fill = null;
            picture.Opacity = 0;
            fallback.Visibility = Visibility.Visible;
            State(user is null ? "未登录" : address is null ? "未设置头像" : "正在加载头像");
        }
        var visit = ++load;
        retryAt = DateTime.MaxValue;
        if (file is not null && address is not null) _ = ShowCached(file, address, visit);
    }

    private async Task ShowCached(string file, string address, int visit)
    {
        var cached = await AvatarCache.Read(file);
        if (visit != load) return;
        var hasPicture = cached.Bytes is { } kept && await Draw(kept, visit);
        if (visit != load) return;
        if (hasPicture && cached.Fresh)
        {
            retryAt = DateTime.UtcNow.AddDays(1);
            return;
        }

        var bytes = await AvatarCache.Fetch(address);
        if (visit != load) return;
        if (bytes is not null && await Draw(bytes, visit))
        {
            if (visit != load) return;
            retryAt = DateTime.UtcNow.AddDays(1);
            await AvatarCache.Write(file, bytes);
        }
        else if (visit == load)
        {
            retryAt = DateTime.UtcNow.AddMinutes(1);
            if (picture.Opacity == 0) State("头像暂时无法显示");
        }
    }

    private async Task<bool> Draw(byte[] bytes, int visit)
    {
        try
        {
            using var stream = new InMemoryRandomAccessStream();
            using (var writer = new DataWriter(stream.GetOutputStreamAt(0)))
            {
                writer.WriteBytes(bytes);
                await writer.StoreAsync();
            }
            if (visit != load) return false;
            stream.Seek(0);
            var bitmap = new BitmapImage { DecodePixelWidth = 100 };
            await bitmap.SetSourceAsync(stream);
            if (visit != load) return false;
            picture.Fill = new ImageBrush { ImageSource = bitmap, Stretch = Stretch.UniformToFill };
            picture.Opacity = 1;
            fallback.Visibility = Visibility.Collapsed;
            State("头像已加载");
            return true;
        }
        catch (Exception error) when (error is COMException or ArgumentException) { return false; }
    }

    private void State(string status)
    {
        if (Status == status) return;
        Status = status;
        AutomationProperties.SetHelpText(this, status);
        Changed?.Invoke();
    }
}
