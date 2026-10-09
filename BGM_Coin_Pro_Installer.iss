#define MyAppName "BGM Coin Pro"
#define MyAppVersion "1.0.3"
#define MyAppPublisher "BGM"
#define MyAppExeName "BGM Coin Pro.exe"

[Setup]
AppId={{B6B7E6A5-AB6C-4F5C-8F15-4D5C10B6C065}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\BGM Coin Pro
DefaultGroupName=BGM Coin Pro
DisableProgramGroupPage=yes
OutputDir=installer_output
OutputBaseFilename=BGM_Coin_Pro_Setup_1.0.3
SetupIconFile=assets\BGM_Coin_Pro.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
PrivilegesRequired=admin

[Files]
Source: "dist\BGM Coin Pro.exe"; DestDir: "{app}"; Flags: ignoreversion restartreplace
Source: "dist\BGM Updater.exe"; DestDir: "{app}"; Flags: ignoreversion restartreplace

[Icons]
Name: "{autodesktop}\BGM Coin Pro"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autoprograms}\BGM Coin Pro"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "BGM Coin Pro'yu başlat"; Flags: nowait postinstall skipifsilent
