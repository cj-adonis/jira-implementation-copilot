using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    internal const string Url = "http://127.0.0.1:43821";
    internal const string Title = "Jira MX Workspace";
    internal static readonly string LogPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Jira MX Workspace", "launcher.log");
    private static readonly object LogLock = new object();

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool first;
        using (var mutex = new Mutex(true, @"Local\JiraMXWorkspaceLauncher", out first))
        {
            if (!first)
            {
                if (Array.IndexOf(args, "--no-browser") >= 0) return 0;
                if (Healthy(null)) Open();
                else MessageBox.Show("The workspace is already starting. Please try again shortly.", Title);
                return 0;
            }
            try
            {
                using (var context = new WorkspaceContext(Array.IndexOf(args, "--no-browser") >= 0))
                    Application.Run(context);
                return 0;
            }
            catch (Exception error)
            {
                Log(error.ToString());
                MessageBox.Show("Could not start the workspace.\n\n" + error.Message + "\n\nLog: " + LogPath, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    internal static void Log(string value)
    {
        if (String.IsNullOrWhiteSpace(value)) return;
        try
        {
            lock (LogLock)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
                if (File.Exists(LogPath) && new FileInfo(LogPath).Length > 1024 * 1024)
                    File.WriteAllText(LogPath, "");
                File.AppendAllText(LogPath, DateTime.Now.ToString("s") + " " + value + Environment.NewLine);
            }
        }
        catch { /* A logging failure must not prevent launch or cleanup. */ }
    }

    internal static bool Healthy(string instance)
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(Url + "/api/health");
            request.Proxy = null;
            request.Timeout = 500;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                string body = reader.ReadToEnd();
                return body.Contains("\"app\":\"jira-mx-workspace\"") && (instance == null || body.Contains(instance));
            }
        }
        catch { return false; }
    }

    internal static void Open()
    {
        try { Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }); }
        catch (Exception error) { MessageBox.Show("Open " + Url + " in your browser.\n\n" + error.Message, Title); }
    }
}

internal sealed class WorkspaceContext : ApplicationContext
{
    private Process server;
    private NotifyIcon tray;
    private System.Windows.Forms.Timer monitor;
    private bool stopping;

    internal WorkspaceContext(bool noBrowser)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "runtime", "node.exe");
            string entry = Path.Combine(root, "apps", "api", "dist", "server.mjs");
            if (!File.Exists(node) || !File.Exists(entry))
                throw new FileNotFoundException("Extract the entire ZIP before running the EXE. Keep it with its runtime and apps folders.");
            var probe = new TcpListener(IPAddress.Loopback, 43821);
            try { probe.Start(); }
            catch (SocketException) { throw new IOException("Port 43821 is already in use. Quit the other application using it and try again."); }
            finally { probe.Stop(); }

            string instance = Guid.NewGuid().ToString("N");
            var start = new ProcessStartInfo(node, "\"" + entry + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.EnvironmentVariables["PORT"] = "43821";
            start.EnvironmentVariables["NODE_ENV"] = "production";
            start.EnvironmentVariables["JIRA_DESKTOP"] = "1";
            start.EnvironmentVariables["JIRA_DESKTOP_INSTANCE"] = instance;
            // Do not inherit development Node preload/debug flags into the distributed app.
            start.EnvironmentVariables.Remove("NODE_OPTIONS");
            server = new Process { StartInfo = start };
            server.OutputDataReceived += (sender, e) => Launcher.Log(e.Data);
            server.ErrorDataReceived += (sender, e) => Launcher.Log(e.Data);
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
            var deadline = DateTime.UtcNow.AddSeconds(25);
            while (!Launcher.Healthy(instance))
            {
                if (server.HasExited) throw new IOException("The local server exited. See the launcher log for details.");
                if (DateTime.UtcNow > deadline) throw new TimeoutException("The local server did not become ready within 25 seconds.");
                Thread.Sleep(150);
            }

            var menu = new ContextMenuStrip();
            menu.Items.Add("Open workspace", null, (sender, e) => Launcher.Open());
            menu.Items.Add("View startup log", null, (sender, e) => {
                Launcher.Log("Log opened.");
                Process.Start(new ProcessStartInfo("notepad.exe", "\"" + Launcher.LogPath + "\"") { UseShellExecute = true });
            });
            menu.Items.Add("Quit", null, (sender, e) => ExitThread());
            tray = new NotifyIcon { Text = Launcher.Title, Icon = SystemIcons.Application, ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (sender, e) => Launcher.Open();
            monitor = new System.Windows.Forms.Timer { Interval = 2000 };
            monitor.Tick += (sender, e) => {
                if (server.HasExited && !stopping)
                {
                    MessageBox.Show("The local server stopped. Start the workspace again.\n\nLog: " + Launcher.LogPath, Launcher.Title);
                    ExitThread();
                }
            };
            monitor.Start();
            if (!noBrowser) Launcher.Open();
        }
        catch { Stop(); throw; }
    }

    private void Stop()
    {
        stopping = true;
        if (monitor != null) { monitor.Stop(); monitor.Dispose(); monitor = null; }
        if (tray != null) { tray.Visible = false; tray.ContextMenuStrip.Dispose(); tray.Dispose(); tray = null; }
        if (server != null)
        {
            try
            {
                if (!server.HasExited)
                {
                    server.StandardInput.Close();
                    if (!server.WaitForExit(5000)) server.Kill();
                }
            }
            catch (InvalidOperationException) { }
            finally { server.Dispose(); server = null; }
        }
    }

    protected override void ExitThreadCore() { Stop(); base.ExitThreadCore(); }
    protected override void Dispose(bool disposing) { if (disposing) Stop(); base.Dispose(disposing); }
}
