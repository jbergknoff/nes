var NES = NES || {};

// Callbacks, object with:
//		ReadCHR: function(Address).
//		WriteCHR: function(Address, Value).
//		RaiseInterrupt: function(NES.InterruptType).
//		DrawScreen: ?
NES.PPU = function(Callbacks)
{
	var Self = this;

	// Registers.
	var ControlRegister1 = 0; // $2000
	var ControlRegister2 = 0; // $2001
	var InVBlank = false; // $2002 bit 7
	var SpriteZeroHit = false; // $2002 bit 6
	var SpriteOverflow = false; // $2002 bit 5
	var SpriteAddress = 0; // $2003

	// Reading $2002 one PPU clock before reads it as clear and never sets the flag or generates NMI for that frame.
	// Ref: http://wiki.nesdev.com/w/index.php/PPU_frame_timing.
	var NMIInhibit;

	// Data used for rendering.
	var PixelsPerScanline = 341;
	var VisiblePixelsPerScanline = 256;
	var VisibleScanlines = 240;
	var ScrollingFlipFlop = false; // Related to scrolling/writing to 0x2005, 0x2006. true means first write has occurred.
	var TempVRAMAddress = 0; // Loopy "latch".
	var VRAMAddress = 0; // Pointer to location in VRAM where reads/writes will occur.
	var VRAMBuffer = 0; // For delayed reads of VRAM memory
	var TempFineX = 0, TempFineY = 0, FineX = 0, FineY = 0;
	var Scanline = NES.ScanlineVBlankBegin; // Same as Nintendulator, per http://wiki.nesdev.com/w/index.php/PPU_power_up_state.
	var Pixel = 0;
	var FrameCounter = 0;

	// Pixel buffer for sprites. Each byte represents a pixel on the screen;
	// Bit 8 is BG flag (0 for normal, 1 for BG sprite), bit 7 is sprite 0 flag, low 4 bits are palette index.
	var SpritePixels = new Uint8Array(NES.VisiblePixelsPerScanline * NES.VisibleScanlines);
	var SpriteZeroX = 0, SpriteZeroY = 0; // The location on screen of sprite #0.

	// A cache of attribute table, decompressed from NES format to a more easily used format.
	// One byte per tile, 32 * 32 tiles per nametable, two nametables.
	var CachedAttributeTable = new Uint8Array(2 * 32 * 32);

	// Data used for interacting with the frontend.
	var DrawScreen = Callbacks.DrawScreen;

	// Interfacing with the rest of the NES.
	var Mirroring = NES.MirroringType.Horizontal;
	var TotalScanlineCount = NES.TotalScanlineCount;
	var ReadCHR = Callbacks.ReadCHR;
	var WriteCHR = Callbacks.WriteCHR;
	var RaiseInterrupt = Callbacks.RaiseInterrupt;

	// Memory-related. PPU Memory Map:
	// Sprite Memory:			0x100 bytes apart from the rest.
	// Pattern Tables:			0x0000 - 0x0FFF, 0x1000 - 0x1FFF
	// Name/Attr Tables:		0x2000 - 0x23FF, 0x2400 - 0x27FF, 0x2800 - 0x2BFF, 0x2C00 - 0x2FFF
	// Mirror of name tables:	0x3000 - 0x3EFF
	// Palettes:				0x3F00 - 0x3F1F
	// Mirror of palettes:		0x3F20 - 0x3FFF
	var SpriteMemory = new Uint8Array(0x100);
	// 0x800 bytes. The two active nametables of 0x2000 - 0x2FFF are mapped to 0x000 and 0x400.
	var PPUMemory = new Uint8Array(0x800);
	var PaletteMemory = new Uint8Array(0x20); // 0x3F00 - 0x3F1F.

	// Data used for interacting with the frontend.
	var Screen = new Uint32Array(NES.VisiblePixelsPerScanline * NES.VisibleScanlines);

	// This is just before scanline -1.
	function EndVBlank()
	{
		InVBlank = false;
		SpriteZeroHit = false;
		SpriteOverflow = false;
		NMIInhibit = false;
		PrepareSprites();
		++FrameCounter;

		// This is important. The VRAM pointer is not set to the latch unless drawing is enabled.
		if ((ControlRegister2 & 0x18) != 0)
			VRAMAddress = TempVRAMAddress;
	}

	function InitializeScanline()
	{
		// When beginning a line and with BG or sprites enabled, get correct VRAM address.
		// Ref: NinTech.txt line 567.
		if ((ControlRegister2 & 0x18) == 0) return;

		VRAMAddress &= 0xFBE0;
		VRAMAddress |= (TempVRAMAddress & 0x041F);
		FineX = TempFineX;
		if (Scanline == 0)
		{
			FineY = TempFineY;
			ExpandAttributeTable();
		}
	}

	// Ticks the PPU, drawing a pixel if appropriate.
	Self.Tick = function()
	{
		// Scanlines 0 - 239 are the picture, 240 is junk and 241 indicates the beginning of VBlank.
		// This NMI may actually be canceled if $2002 is written to during the second pixel of SL 241.
		if (Scanline == NES.ScanlineVBlankBegin && Pixel == 0 && !NMIInhibit)
		{
			InVBlank = true;
			if ((ControlRegister1 & 0x80) != 0) RaiseInterrupt(NES.InterruptType.NMI);
			DrawScreen(Screen, FrameCounter);
		}

		// If this scanline/pixel are to be drawn at this time, draw it.
		if (Scanline >= 0 && Scanline < VisibleScanlines && Pixel < VisiblePixelsPerScanline)
		{
			if (Pixel == 0) InitializeScanline();

			var PixelColor = ProcessPixel();
			Screen[NES.VisiblePixelsPerScanline * Scanline + Pixel] = PixelColor;
		}

		// Bookkeeping for scanlines, etc., even when the pixel isn't being drawn.
		++Pixel;

		// On NTSC, scanline -1 of every other frame is one pixel shorter than usual. Skip over pixel 337.
		// 337 is the only pixel for which Blargg's 10-even_odd_timing.nes gives a pass.
		if (Pixel == 337 && Scanline == -1 && (FrameCounter & 1) == 0 && (ControlRegister2 & 0x08) != 0)
			++Pixel;

		if (Pixel > PixelsPerScanline - 1)
		{
			Pixel = 0;
			++Scanline;
		}

		// NTSC: Scanline 260. PAL: Scanline 310.
		if (Scanline == TotalScanlineCount - 1) Scanline = -1;
		if (Scanline == -1 && Pixel == 0) EndVBlank();
	}

	function ProcessPixel()
	{
		// Note that if ControlRegister2 & 0x18 == 0, i.e. if BG and sprites are disabled, then we immediately exit.
		//if (Scanline == -1 || Pixel >= NES.VisiblePixelsPerScanline || Scanline >= NES.VisibleScanlines || (ControlRegister2 & 0x18) == 0)
		// Foregoing the above checks because Tick() does the first three for us.
		if ((ControlRegister2 & 0x18) == 0)
			return PaletteMemory[0];

		var PaletteIndex = 0;

		var SpritePixel = SpritePixels[256 * Scanline + Pixel];
		// If nametable clipping is enabled and we're in the left 8 pixels, skip drawing. Otherwise, draw.
		PaletteIndex = ((ControlRegister2 & 2) == 0 && Pixel < 8) ? 0 : DrawBGPixel();
		var BGTransparent = (PaletteIndex == 0);

		if ((SpritePixel & 0x0F) != 0 && (Pixel >= 8 || (ControlRegister2 & 0x04) != 0) // If there is a sprite at this pixel...
				&& ((SpritePixel & 0x80) == 0 || BGTransparent)) // and it's a foreground sprite or the BG is transparent,
		{
			PaletteIndex = 0x10 + (SpritePixel & 0xF); // then draw the sprite instead of the BG.
		}

		// If we are in the vicinity of sprite #0, check if we should set SpriteZeroHit.
		// Scanline is zero-indexed, 0-239. SpriteZeroY can be between 1 and 256.
		var SpriteHeight = (ControlRegister1 & 0x20) == 0 ? 8 : 16;
		if ((ControlRegister2 & 0x18) == 0x18 && !BGTransparent && !SpriteZeroHit
			&& Scanline >= SpriteZeroY && Scanline < SpriteZeroY + SpriteHeight && Pixel >= SpriteZeroX && Pixel < SpriteZeroX + SpriteHeight
			&& Pixel != 255 && (Pixel >= 8 || (ControlRegister2 & 0x04) != 0)) // Check sprite left-eight-pixels clipping
		{
			SpriteZeroHit = (SpritePixels[256 * Scanline + Pixel] & 0x40) != 0;
		}

		// These VRAM pointer updates assume that we are rendering the pixel and incrementing things accordingly.
		// Therefore, only do the updates if background rendering is turned on, $2001.3.
		if ((ControlRegister2 & 0x08) != 0)
		{
			++FineX;
			FineX &= 7;
			if (FineX == 0)
			{
				if ((VRAMAddress & 0x1F) == 0x1F)
				{
					VRAMAddress &= 0xFFE0;
					VRAMAddress ^= 0x0400;
				}
				else
					++VRAMAddress;
			}

			//if (Pixel == NES.VisiblePixelsPerScanline - 1)
			if (Pixel == 255)
			{
				++FineY;
				FineY &= 7;
				if (FineY == 0)
				{
					if ((VRAMAddress & 0x03A0) == 0x03A0)
					{
						VRAMAddress &= 0xFC1F;
						VRAMAddress ^= 0x0800;
					}
					// If $2006 set TileY to 30 or 31, it will get to 31 and here we will wrap it to zero but not flip high NT bit.
					else if ((VRAMAddress & 0x03E0) == 0x03E0) VRAMAddress &= 0xFC1F;
					else VRAMAddress += (1 << 5);
				}
			}
		}

		return PaletteMemory[PaletteIndex];
	}

	function DrawBGPixel()
	{
		// Locate the pixel in the name table which tells us what tile to draw with.
		// Name table is 30 rows x 32 columns long, each entry representing an 8x8 tile. 30 * 32 = 0x3C0 bytes long.
		// TileNumber is the index into the name table, like counting up tiles left to right then top to bottom.
		// TileIndex is the index into the CHR memory.
		var NameTableAddress = ((VRAMAddress & Mirroring) == 0 ? 0 : 0x0400) + (VRAMAddress & 0x03FF);
		var TileIndex = PPUMemory[NameTableAddress];

		// Get pattern table data for the tile.
		// Pattern table has 256 tiles, each 128 bits = 16 bytes long, two bits per pixel in an 8x8 tile.

		var PatternTableAddress = ((ControlRegister1 & 0x10) << 8) + 16 * TileIndex + FineY;
		var Shift = 7 - FineX;
		var LowColor = ((ReadCHR(PatternTableAddress) >> Shift) & 1) | (((ReadCHR(PatternTableAddress + 8) >> Shift) << 1) & 2);

		// Background pixel is transparent if LowColor == 0, and doesn't use the upper color bits.
		if (LowColor == 0)
			return 0;

		return CachedAttributeTable[NameTableAddress] | LowColor;
	}

	Self.WriteRegister = function(Address, Value)
	{
		// These 8 bytes are mirrored from 0x2000 to 0x3FFF. Collapse to the real address.
		Address &= 0x2007;

		switch (Address)
		{
			case 0x2000:
				var RaiseNMI = (Value & 0x80) != 0 && (ControlRegister1 & 0x80) == 0 && InVBlank; // Enabling NMI while in VBlank will trigger an NMI.
				if (Scanline == TotalScanlineCount - 2 && Pixel == PixelsPerScanline - 1) RaiseNMI = false; // Special case: can't raise NMI on final cycle of VBlank.

				ControlRegister1 = Value;
				if (RaiseNMI && !NMIInhibit) RaiseInterrupt(NES.InterruptType.NMI);
				// Special case: disabling NMI on second pixel of VBlank should cancel NMI.
				if ((Value & 0x80) == 0 && Scanline == NES.ScanlineVBlankBegin && Pixel == 1)
				{
					console.log("cancel nmi 1");
					RaiseInterrupt(NES.InterruptType.CancelNMI);
				}

				TempVRAMAddress = (TempVRAMAddress & 0xF3FF) | ((Value & 3) << 10);
				break;

			case 0x2001:
				ControlRegister2 = Value;
				break;

			case 0x2003:
				SpriteAddress = Value;
				break;

			case 0x2004:
				SpriteMemory[SpriteAddress++] = Value;
				break;

			// For $2005 and $2006 behavior, see NinTech.txt section 3g (Scrolling).
			// ScrollingFlipFlop == false when first write has not occurred.
			case 0x2005:
				if (!ScrollingFlipFlop)
				{
					TempVRAMAddress = (TempVRAMAddress & 0x7FE0) | (Value >> 3);

					// Again, important: FineX should not be updated if the screen is currently drawing.
					// Therefore, buffer the value and assign it when necessary (i.e. start of scanline)
					// Ref: NinTech.txt line 567.
					TempFineX = Value & 7;
				}
				else
				{
					TempVRAMAddress &= 0x0C1F;
					TempVRAMAddress |= ((Value & 0xF8) << 2);
					TempFineY = Value & 7;
					TempVRAMAddress |= (TempFineY << 12);
				}

				ScrollingFlipFlop = !ScrollingFlipFlop;

				break;

			case 0x2006:
				if (!ScrollingFlipFlop)
					TempVRAMAddress = (TempVRAMAddress & 0x00FF) | ((Value & 0x3F) << 8);
				else
				{
					TempVRAMAddress = (TempVRAMAddress & 0x7F00) | Value;
					VRAMAddress = TempVRAMAddress & 0x3FFF;
				}

				ScrollingFlipFlop = !ScrollingFlipFlop;

				break;

			case 0x2007:
				if (VRAMAddress >= 0x3F00)
				{
					PaletteMemory[VRAMAddress & 0x1F] = Value;

					// Special case that writing to 0x3F10 mirrors to 0x3F00.
					if (VRAMAddress == 0x3F10) PaletteMemory[0] = Value;
				}
				else if (VRAMAddress >= 0x2000)
				{
					// There are four name tables addressed here, but only two actual name tables.
					// Two name tables are mirrored.
					// Horizontal mirroring:	0x2000 and 0x2400 point to 0x2000, while 0x2800 and 0x2C00 point to 0x2400.
					//							0x2056 --> 0x0056, 0x2456 --> 0x0056, 0x2856 --> 0x0456, 0x2C56 --> 0x0456 (my implementation)
					//							VRAMAddress & 0x0800 == 0 implies mirroring to 0x2000.
					// Vertical mirroring:		0x2000 and 0x2800 point to 0x2000, while 0x2400 and 0x2C00 point to 0x2400.
					//							0x2056 --> 0x0056, 0x2456 --> 0x0456, 0x2856 --> 0x0056, 0x2C56 --> 0x0456 (my implementation)
					//							VRAMAddress & 0x0400 == 0 implies mirroring to 0x2000
					var NameTableZero = (VRAMAddress & Mirroring) == 0;
					PPUMemory[(NameTableZero ? 0 : 0x0400) + (VRAMAddress & 0x03FF)] = Value;
				}
				else
				{
					//throw new Exception("Trying to write to ROM pattern tables.");
					WriteCHR(VRAMAddress, Value);
				}

				if ((ControlRegister1 & 4) == 0) ++VRAMAddress;
				else VRAMAddress += 32;
				VRAMAddress &= 0x3FFF;

				break;
		}
	}

	Self.ReadRegister = function(Address)
	{
		Address &= 0x2007; // These 8 bytes are mirrored from 0x2000 to 0x4000. Collapse to the real address.

		switch (Address)
		{
			case 0x2002:
				// Special race condition for reading VBlank on PPU cycle when it is being set.
				// Ref: http://wiki.nesdev.com/w/index.php/PPU_frame_timing
				if (Pixel == PixelsPerScanline - 1 && Scanline == NES.ScanlineVBlankBegin - 1)
				{
					InVBlank = false;
					NMIInhibit = true;
				}
				else if (Pixel <= 1 && Scanline == NES.ScanlineVBlankBegin)
				{
					InVBlank = true;
					NMIInhibit = true;
					if (Pixel == 1)
					{
						console.log("cancel nmi 2");
						RaiseInterrupt(NES.InterruptType.CancelNMI);
					}
				}

				var Value = (InVBlank ? 0x80 : 0) | (SpriteZeroHit ? 0x40 : 0) | (SpriteOverflow ? 0x20 : 0);
				InVBlank = false;
				ScrollingFlipFlop = false;
				return Value;

			case 0x2004:
				return SpriteMemory[SpriteAddress];

			case 0x2007:
				var ReturnValue;

				if (VRAMAddress >= 0x3F00)
				{
					// Palette: See Line 422 of NinTech.txt.
					// Returns the palette byte without buffering, but buffers the value from 0x2Fab if VRAMAddress
					// is 0x3Fab. The 0x2C00 - 0x2FFF name table always mirrors to 0x2400.
					VRAMBuffer = PPUMemory[0x0400 + (VRAMAddress & 0x3FF)];
					if (VRAMAddress == 0x3F10) return PaletteMemory[0];
					ReturnValue = PaletteMemory[VRAMAddress & 0x1F];

					// TODO: something about reading palette with monochrome bit set.
				}
				else
				{
					ReturnValue = VRAMBuffer;

					if (VRAMAddress >= 0x2000)
					{
						// See routine for writing to $2007 for documentation.
						var NameTableZero = (VRAMAddress & Mirroring) == 0;
						VRAMBuffer = PPUMemory[(NameTableZero ? 0 : 0x0400) + (VRAMAddress & 0x03FF)];
					}
					else
						VRAMBuffer = ReadCHR(VRAMAddress);
				}

				if ((ControlRegister1 & 4) == 0) ++VRAMAddress;
				else VRAMAddress += 32;
				VRAMAddress &= 0x3FFF;

				return ReturnValue;
		}

		throw new Exception("Reading PPU register $" + Address.ToString("X4") + " not implemented.");
	}

	// Copy 256 bytes from CPUMemory into sprite RAM.
	Self.DMA = function(SourceData)
	{
		for (var i = 0; i < 0x100; i++)
			SpriteMemory[(SpriteAddress + i) & 0xFF] = SourceData[i];
	}

	Self.SetMirroring = function(NewMirroring)
	{
		Mirroring = NewMirroring;
	}

	function PrepareSprites()
	{
		var ScreenX, ScreenY, TileNumber, Attributes;
		var FlipHorizontally;
		var FlipVertically;
		var Background;
		var SpriteHeight = (ControlRegister1 & 0x20) == 0 ? 8 : 16;
		var SpritePatternTable = (ControlRegister1 & 0x08) << 9;
		var PatternTableByte0, PatternTableByte1;
		var LowColor, PaletteIndex;

		SpritePixels = new Uint8Array(256 * 240);
		SpriteZeroX = SpriteMemory[3];
		SpriteZeroY = SpriteMemory[0] + 1;

		// Lower index has higher priority, so iterate backwards.
		for (var i = 63; i >= 0; --i)
		{
			//ScreenY = (byte)(SpriteMemory[4 * i] + 1); // The value stored is actually Y - 1, so we increment.
			ScreenY = SpriteMemory[4 * i] + 1;
			if (ScreenY == 0 || ScreenY > 239) continue; // Sprite is outside the screen.
			TileNumber = SpriteMemory[4 * i + 1];
			Attributes = SpriteMemory[4 * i + 2];
			ScreenX = SpriteMemory[4 * i + 3];
			FlipHorizontally = (Attributes & 0x40) != 0;
			FlipVertically = (Attributes & 0x80) != 0;
			Background = (Attributes & 0x20) != 0;

			if (SpriteHeight == 16)
			{
				SpritePatternTable = (TileNumber & 0x01) << 12;
				// Sprite will use tiles 2n and 2n+1; n given by bits 1-7 of TileNumber.
				// Normally, tile 2n comes first. If vertically flipped, tile 2n+1 comes first.
				if (FlipVertically) TileNumber |= 0x01;
				else TileNumber &= 0xFE;
			}

			// Dealing with the *screen* pixel at (ScreenX + ScreenOffsetX, ScreenY + ScreenOffsetY).
			// ScreenOffsetX and ScreenOffsetY are *screen* quantities, not reflecting sprite flips, etc.
			for (var ScreenOffsetY = 0; ScreenOffsetY < SpriteHeight; ++ScreenOffsetY)
			{
				if (ScreenY + ScreenOffsetY > 239) continue;
				if (ScreenOffsetY == 8 && SpriteHeight == 16) TileNumber ^= 0x01; // Bottom half of sprite is the other tile of 2n and 2n+1.
				// SpriteY is the Y coordinate of the pixel within the sprite, constrained between 0 and 7.
				var SpriteY = (FlipVertically ? SpriteHeight - 1 - ScreenOffsetY : ScreenOffsetY) & 0x07;

				// Get lower color bits from pattern table, once per row, and combine with upper color bits from Attributes, every pixel.
				var PatternTableAddress = (SpritePatternTable + 16 * TileNumber + SpriteY) & 0x1FFF;
				PatternTableByte0 = ReadCHR(PatternTableAddress);
				PatternTableByte1 = ReadCHR(PatternTableAddress + 8);

				for (var ScreenOffsetX = 0; ScreenOffsetX < 8; ++ScreenOffsetX)
				{
					if (ScreenX + ScreenOffsetX > 255) continue;
					var SpriteX = (FlipHorizontally ? 7 - ScreenOffsetX : ScreenOffsetX);

					// If this sprite's pixel is deemed worthy of drawing, put it in the SpritePixelData hashtable.
					// If there's no previous sprite at this pixel, draw it.
					// Otherwise (there is a previous sprite), draw it if this one is non-BG    OR    if this one is BG and prev is also BG.
					// Also let sprite #0 in here, regardless, so it can fill out its stencil which requires LowColor.
					var SpritePixel = SpritePixels[256 * (ScreenY + ScreenOffsetY) + (ScreenX + ScreenOffsetX)];
					if (SpritePixel == 0 || !Background || (SpritePixel & 0x80) != 0 || i == 0)
					{
						// Skip transparent pixels which have low palette bits = 0.
						LowColor = ((PatternTableByte0 >> (7 - SpriteX)) & 1) | (((PatternTableByte1 >> (7 - SpriteX)) << 1) & 2);
						if (LowColor == 0) continue;

						// SpriteZeroPixelData stores a stencil of how sprite #0 appears on the screen, false for transparent pixel, true otherwise.
						if (i == 0)
						{
							SpritePixels[256 * (ScreenY + ScreenOffsetY) + (ScreenX + ScreenOffsetX)] |= 0x40;

							// Double-check that sprite #0 should be doing what follows this block.
							// Namely, if sprite #0 is a BG sprite and there's already a non-BG pixel in place, skip.
							if (Background && SpritePixel != 0 && (SpritePixel & 0x80) == 0)
								continue;
						}

						PaletteIndex = LowColor | ((Attributes << 2) & 0x0C);
						// |= is necessary for sprite zero hit to work, but apparently this is also related
						// to the red waterfall in the zelda 1 intro. Revisit when mapper 1 is implemented.
						SpritePixels[256 * (ScreenY + ScreenOffsetY) + (ScreenX + ScreenOffsetX)] |= (PaletteIndex | (Background ? 0x80 : 0)) & 0xFF;

						//if (((PaletteIndex | (Background ? 0x80 : 0)) & 0xFF) != (SpritePixels[256 * (ScreenY + ScreenOffsetY) + (ScreenX + ScreenOffsetX)] | (PaletteIndex | (Background ? 0x80 : 0)) & 0xFF))
						//	console.log(((PaletteIndex | (Background ? 0x80 : 0)) & 0xFF), (SpritePixels[256 * (ScreenY + ScreenOffsetY) + (ScreenX + ScreenOffsetX)] | (PaletteIndex | (Background ? 0x80 : 0)) & 0xFF));
					}
				}
			}
		}
	}

	// Expand the attribute table from the compressed PPU format into an easily accessed
	// byte array, one byte per tile. Intended to be called once, when a frame starts drawing,
	// in order to speed up inner drawing loop.
	// Attribute table is for 32 x 32 tiles, one byte per 4 x 4 sub-matrix of tiles. 32 * 32 / 16 = 0x40 bytes long.
	/* Attribute byte applies to a 4x4 grid of tiles. nestech.txt line 490:
	+------------+------------+
	|  Square 0  |  Square 1  |  #0-F represents an 8x8 tile
	|   #0  #1   |   #4  #5   |
	|   #2  #3   |   #6  #7   |  Square [x] represents four (4) 8x8 tiles
	+------------+------------+   (i.e. a 16x16 pixel grid)
	|  Square 2  |  Square 3  |
	|   #8  #9   |   #C  #D   |
	|   #A  #B   |   #E  #F   |
	+------------+------------+
	Attribute byte layout is 33221100.
	*/
	function ExpandAttributeTable()
	{
		CachedAttributeTable = new Uint8Array(2 * 32 * 32);

		var AttributeByte, Temp;
		// Step through 4x4 tile blocks. There are 64 of them.
		for (var CoarseY = 0; CoarseY < 8; CoarseY++)
		{
			for (var CoarseX = 0; CoarseX < 8; CoarseX++)
			{
				AttributeByte = PPUMemory[0x03C0 + 8 * CoarseY + CoarseX];
				//Temp = (byte)((AttributeByte & 0x03) << 2);
				Temp = (AttributeByte & 0x03) << 2;
				CachedAttributeTable[32 * (4 * CoarseY + 0) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 0) + 4 * CoarseX + 1] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 1) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 1) + 4 * CoarseX + 1] = Temp;
				//Temp = (byte)(AttributeByte & 0x0C);
				Temp = AttributeByte & 0x0C;
				CachedAttributeTable[32 * (4 * CoarseY + 0) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 0) + 4 * CoarseX + 3] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 1) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 1) + 4 * CoarseX + 3] = Temp;
				//Temp = (byte)((AttributeByte & 0x30) >> 2);
				Temp = (AttributeByte & 0x30) >> 2;
				CachedAttributeTable[32 * (4 * CoarseY + 2) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 2) + 4 * CoarseX + 1] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 3) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 3) + 4 * CoarseX + 1] = Temp;
				//Temp = (byte)((AttributeByte & 0xC0) >> 4);
				Temp = (AttributeByte & 0xC0) >> 4;
				CachedAttributeTable[32 * (4 * CoarseY + 2) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 2) + 4 * CoarseX + 3] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 3) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[32 * (4 * CoarseY + 3) + 4 * CoarseX + 3] = Temp;

				AttributeByte = PPUMemory[0x07C0 + 8 * CoarseY + CoarseX];
				//Temp = (byte)((AttributeByte & 0x03) << 2);
				Temp = (AttributeByte & 0x03) << 2;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 0) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 0) + 4 * CoarseX + 1] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 1) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 1) + 4 * CoarseX + 1] = Temp;
				//Temp = (byte)(AttributeByte & 0x0C);
				Temp = AttributeByte & 0x0C;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 0) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 0) + 4 * CoarseX + 3] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 1) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 1) + 4 * CoarseX + 3] = Temp;
				//Temp = (byte)((AttributeByte & 0x30) >> 2);
				Temp = (AttributeByte & 0x30) >> 2;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 2) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 2) + 4 * CoarseX + 1] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 3) + 4 * CoarseX + 0] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 3) + 4 * CoarseX + 1] = Temp;
				//Temp = (byte)((AttributeByte & 0xC0) >> 4);
				Temp = (AttributeByte & 0xC0) >> 4;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 2) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 2) + 4 * CoarseX + 3] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 3) + 4 * CoarseX + 2] = Temp;
				CachedAttributeTable[0x0400 + 32 * (4 * CoarseY + 3) + 4 * CoarseX + 3] = Temp;
			}
		}
	}
}
