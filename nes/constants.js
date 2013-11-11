var NES = NES || {};

NES.InterruptType =
{
	"None": 0,
	"IRQBRK": 1,
	"NMI": 2,
	"Reset": 3,
	"CancelNMI": 4
}

//NES.PRGPageSize = 0x4000;
NES.PRGPageSize = 0x2000;
//NES.CHRPageSize = 0x2000;
NES.CHRPageSize = 0x0400; // Some mappers use CHR pages as small as 0x400 = 1 kilobyte.
NES.StackAddress = 0x0100;

NES.MirroringType =
{
	"SingleScreen": 0x0000,
	"Horizontal": 0x0800,
	"Vertical": 0x0400
};

// I index my scanlines as in Nintendulator, with first (junk) scanline being -1.
// Then the rendered scanlines are 0 - 239.
// Junk scanline 240
// The vblank scanlines are (NTSC) 241 - 260 and (PAL) 241 - 310
NES.PixelsPerScanline = 341;
NES.VisiblePixelsPerScanline = 256;
NES.VisibleScanlines = 240;
NES.ScanlineVBlankBegin = 241;
// The following PPU constants are indexed by region, 0 for NTSC and 1 for PAL.
// Cycles are "master cycles" as run by the PPU processor.
NES.CyclesPerPixel = 4; // { 4, 5 };
NES.CyclesPerCPUCycle = 12; // { 12, 16 };
NES.CPUCyclesPerSecond = 1789773; // { 1789773, 1662607 };
NES.TotalScanlineCount = 262; // { 262, 312 };
