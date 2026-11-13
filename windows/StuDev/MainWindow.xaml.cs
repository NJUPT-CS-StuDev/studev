using Microsoft.UI.Xaml;

namespace StuDev;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        var doc = StuDev.Kernels.Docstream.DocstreamNativeMethods.Math("x^2", false);
        Status.Text = $"StuDev · 内核可用：公式 {doc?.Length ?? 0} 字节";
    }
}
