var NES = NES || {};

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
